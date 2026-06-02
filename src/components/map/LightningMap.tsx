import { useEffect, useMemo, useRef, useState } from 'react';
import { divIcon } from 'leaflet';
import {
  Circle,
  CircleMarker,
  MapContainer,
  Marker,
  Pane,
  Polygon,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
  WMSTileLayer,
  useMapEvents,
} from 'react-leaflet';
import type {
  AlertConfig,
  LatLng,
  LightningStrike,
  MonitoredLocation,
} from '@/services/lightning/types';
import { haversineKm } from '@/services/lightning/geo';

const ML_PREDICTION_URL = import.meta.env.VITE_ML_URL ?? 'http://localhost:5000/ml/predict';
const ML_POLL_INTERVAL_MS = 60_000;
const PREDICTION_STROKE = '#b56cff';
const CLUSTER_STROKE = '#ff9f43';
const NEXRAD_WMS_URL = 'https://opengeo.ncep.noaa.gov/geoserver/conus/conus_bref_qcd/ows';
const NEXRAD_WMS_LAYER = 'conus_bref_qcd';
const RADAR_REFRESH_DEBOUNCE_MS = 300;
const predictionLabelIcon = divIcon({
  className: 'storm-prediction-label',
  html: '<div></div>',
  iconSize: [0, 0],
});

interface MlPredictionResponse {
  ready: boolean;
  confidence?: number;
  predictedBoundingBox?: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
  predictedCenter?: { lat: number; lng: number };
  clusterSamples?: number;
  timeBuckets?: number;
}

interface PredictionOverlayData {
  bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
  center: { lat: number; lng: number };
  confidencePercent: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseMlPredictionPayload(raw: unknown): MlPredictionResponse {
  if (!isRecord(raw)) {
    throw new Error('Invalid ML prediction payload: expected an object');
  }

  if (typeof raw.ready !== 'boolean') {
    throw new Error('Invalid ML prediction payload: ready must be boolean');
  }

  const confidence = raw.confidence;
  if (confidence !== undefined && (typeof confidence !== 'number' || !Number.isFinite(confidence))) {
    throw new Error('Invalid ML prediction payload: confidence must be numeric when present');
  }

  const predictedBoundingBox = raw.predictedBoundingBox;
  if (predictedBoundingBox !== undefined) {
    if (!isRecord(predictedBoundingBox)) {
      throw new Error('Invalid ML prediction payload: predictedBoundingBox must be an object');
    }
    const bboxValues = [
      predictedBoundingBox.north,
      predictedBoundingBox.south,
      predictedBoundingBox.east,
      predictedBoundingBox.west,
    ];
    if (bboxValues.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
      throw new Error('Invalid ML prediction payload: predictedBoundingBox values must be numbers');
    }
  }

  const predictedCenter = raw.predictedCenter;
  if (predictedCenter !== undefined) {
    if (!isRecord(predictedCenter)) {
      throw new Error('Invalid ML prediction payload: predictedCenter must be an object');
    }
    if (
      typeof predictedCenter.lat !== 'number'
      || !Number.isFinite(predictedCenter.lat)
      || typeof predictedCenter.lng !== 'number'
      || !Number.isFinite(predictedCenter.lng)
    ) {
      throw new Error('Invalid ML prediction payload: predictedCenter values must be numbers');
    }
  }

  const clusterSamples = raw.clusterSamples;
  if (clusterSamples !== undefined && (typeof clusterSamples !== 'number' || !Number.isFinite(clusterSamples))) {
    throw new Error('Invalid ML prediction payload: clusterSamples must be numeric when present');
  }

  const timeBuckets = raw.timeBuckets;
  if (timeBuckets !== undefined && (typeof timeBuckets !== 'number' || !Number.isFinite(timeBuckets))) {
    throw new Error('Invalid ML prediction payload: timeBuckets must be numeric when present');
  }

  return {
    ready: raw.ready,
    confidence: confidence as number | undefined,
    predictedBoundingBox: predictedBoundingBox as MlPredictionResponse['predictedBoundingBox'],
    predictedCenter: predictedCenter as MlPredictionResponse['predictedCenter'],
    clusterSamples: clusterSamples as number | undefined,
    timeBuckets: timeBuckets as number | undefined,
  };
}

// ── Strike trail: fading polyline showing storm motion ────────────
function StrikeTrail({ strikes }: { strikes: LightningStrike[] }) {
  // Sort by time, keep last 30 min, bucket into 3-min slots to draw a motion path
  const now = Date.now();
  const windowMs = 30 * 60 * 1000;
  const bucketMs = 3 * 60 * 1000;
  const numBuckets = windowMs / bucketMs; // 10 buckets

  const buckets: LightningStrike[][] = Array.from({ length: numBuckets }, () => []);
  for (const s of strikes) {
    const age = now - s.timestamp;
    if (age > windowMs) continue;
    const bucket = Math.min(numBuckets - 1, Math.floor(age / bucketMs));
    // Bucket 0 = most recent, higher = older
    buckets[bucket].push(s);
  }

  // Compute centroid per bucket (oldest → newest for path direction)
  const centroids: [number, number][] = [];
  for (let i = numBuckets - 1; i >= 0; i--) {
    const bucket = buckets[i];
    if (bucket.length === 0) continue;
    const lat = bucket.reduce((s, x) => s + x.lat, 0) / bucket.length;
    const lng = bucket.reduce((s, x) => s + x.lng, 0) / bucket.length;
    centroids.push([lat, lng]);
  }

  if (centroids.length < 2) return null;

  return (
    <Polyline
      positions={centroids}
      pathOptions={{
        color: CLUSTER_STROKE,
        weight: 3,
        opacity: 0.7,
        dashArray: '8 6',
      }}
    />
  );
}

// ── Storm cell overlay from ML clustering ─────────────────────────
function StormCellOverlay({ prediction }: { prediction: PredictionOverlayData }) {
  const { north, south, east, west } = prediction.bounds;
  const { lat: cLat, lng: cLng } = prediction.center;

  // Draw the cluster bounding box
  const polygon: [number, number][] = [
    [north, west],
    [north, east],
    [south, east],
    [south, west],
  ];

  // Direction arrow: small offset from center toward predicted movement
  // (We don't have previous center, so just show a motion hint label)
  const centerPos: [number, number] = [cLat, cLng];

  return (
    <>
      {/* Predicted zone box */}
      <Polygon
        positions={polygon}
        pathOptions={{
          color: PREDICTION_STROKE,
          fillColor: PREDICTION_STROKE,
          fillOpacity: 0.12,
          weight: 2,
          opacity: 0.8,
          dashArray: '10 8',
        }}
      />
      {/* Storm cell label at center */}
      <Marker position={centerPos} icon={predictionLabelIcon} interactive={false}>
        <Tooltip
          permanent
          direction="center"
          opacity={1}
          className="!bg-transparent !border-0 !shadow-none"
        >
          <div className="rounded-xl border border-[#d2b6ff]/40 bg-[#2d1247]/85 px-3 py-2 text-center shadow-[0_12px_35px_rgba(98,38,138,0.28)] backdrop-blur-sm">
            <div className="text-[10px] font-mono uppercase tracking-[0.22em] text-[#f0dcff]">
              Storm Cell
            </div>
            <div className="mt-1 text-xs font-mono text-[#cfa7ff]">
              {prediction.confidencePercent}% confidence
            </div>
          </div>
        </Tooltip>
      </Marker>
    </>
  );
}

function MapCenterEffect({ center }: { center: [number, number] }) {
  const map = useMap();
  const prevCenter = useRef(center);

  useEffect(() => {
    if (
      prevCenter.current[0] !== center[0] ||
      prevCenter.current[1] !== center[1]
    ) {
      map.flyTo(center, map.getZoom(), { duration: 1.2 });
      prevCenter.current = center;
    }
  }, [center, map]);

  return null;
}

// ── Newest-strike flash effect ────────────────────────────────────
function FlashEffect({ strike }: { strike: LightningStrike }) {
  return (
    <>
      {/* Expanding ring */}
      <CircleMarker
        center={[strike.lat, strike.lng]}
        radius={24}
        pathOptions={{
          color: '#ffe033',
          fillColor: 'transparent',
          fillOpacity: 0,
          weight: 1.5,
          opacity: 0,
          className: 'animate-ring-expand',
        }}
      />
    </>
  );
}

function MapClickCapture({ onMoveMonitoredLocation }: { onMoveMonitoredLocation: (location: LatLng) => void }) {
  useMapEvents({
    click(event) {
      onMoveMonitoredLocation({
        lat: event.latlng.lat,
        lng: event.latlng.lng,
      });
    },
  });

  return null;
}

function DebouncedRadarLayer() {
  const [isInteracting, setIsInteracting] = useState(false);
  const [refreshToken, setRefreshToken] = useState(() => Date.now());
  const refreshTimerRef = useRef<number | null>(null);

  const scheduleRefresh = () => {
    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current);
    }
    refreshTimerRef.current = window.setTimeout(() => {
      setIsInteracting(false);
      setRefreshToken(Date.now());
      refreshTimerRef.current = null;
    }, RADAR_REFRESH_DEBOUNCE_MS);
  };

  useMapEvents({
    movestart() {
      setIsInteracting(true);
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    },
    zoomstart() {
      setIsInteracting(true);
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    },
    moveend() {
      scheduleRefresh();
    },
    zoomend() {
      scheduleRefresh();
    },
  });

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
      }
    };
  }, []);

  if (isInteracting) {
    return null;
  }

  return (
    <WMSTileLayer
      key={`nexrad-${refreshToken}`}
      url={NEXRAD_WMS_URL}
      layers={NEXRAD_WMS_LAYER}
      format="image/png"
      transparent
      opacity={0.35}
      version="1.3.0"
      pane="radar-overlay"
      attribution="NOAA/NWS NEXRAD"
      updateWhenIdle
    />
  );
}

function strikeAgeSeconds(strike: LightningStrike): number {
  if (typeof strike.ageSeconds === 'number' && Number.isFinite(strike.ageSeconds)) {
    return Math.max(0, Math.round(strike.ageSeconds));
  }
  return Math.max(0, Math.round((Date.now() - strike.timestamp) / 1000));
}

function strikeTypeLabel(strikeType?: LightningStrike['strikeType']) {
  if (strikeType === 'cg') return 'Cloud-to-Ground';
  if (strikeType === 'ic') return 'In-Cloud';
  return 'Unknown';
}

// ── Strike age → visual properties ───────────────────────────────
function strikeVisuals(strike: LightningStrike, isNewest: boolean, monitored: MonitoredLocation) {
  const ageSec = strikeAgeSeconds(strike);
  const dist = haversineKm(monitored.lat, monitored.lng, strike.lat, strike.lng);

  // Keep strike dots tight so the map remains visible: 6–10 px.
  const intensityFactor = Math.min(Math.max(strike.intensityKa, 0), 120) / 120;
  const radius = 6 + intensityFactor * 4;

  // Requested mapping: <=120s is fresh (yellow), >120s is aging (red).
  const color = ageSec <= 120 ? '#ffe033' : '#ff3333';
  const opacity = isNewest ? 0.85 : 0.8;

  return { radius, color, opacity, dist };
}

// ── Safety radius ring colors ─────────────────────────────────────
const RADIUS_RINGS = [
  { key: 'danger',  color: '#ff3333', label: 'Danger'  },
  { key: 'warning', color: '#ff8800', label: 'Warning' },
  { key: 'caution', color: '#ffe033', label: 'Caution' },
] as const;

// ── Main component ────────────────────────────────────────────────
interface LightningMapProps {
  strikes: LightningStrike[];
  monitored: MonitoredLocation;
  alertConfig: AlertConfig;
  newestStrikeId: string | null;
  selectedStrikeId: string | null;
  onSelectStrike: (strike: LightningStrike) => void;
  onMoveMonitoredLocation: (location: LatLng) => void;
}

export function LightningMap({
  strikes,
  monitored,
  alertConfig,
  newestStrikeId,
  selectedStrikeId,
  onSelectStrike,
  onMoveMonitoredLocation,
}: LightningMapProps) {
  const center = useMemo<[number, number]>(() => [monitored.lat, monitored.lng], [monitored.lat, monitored.lng]);
  const [prediction, setPrediction] = useState<PredictionOverlayData | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadPrediction = async () => {
      try {
        const response = await fetch(ML_PREDICTION_URL);
        if (!response.ok) return;
        const raw = await response.json();
        const payload = parseMlPredictionPayload(raw);
        if (cancelled) return;

        if (!payload.ready || !payload.predictedBoundingBox || !payload.predictedCenter) {
          setPrediction(null);
          return;
        }

        const rawConfidence = payload.confidence ?? 0;
        const confidencePercent = Math.round(rawConfidence <= 1 ? rawConfidence * 100 : rawConfidence);
        setPrediction({
          bounds: payload.predictedBoundingBox,
          center: payload.predictedCenter,
          confidencePercent,
        });
      } catch {
        if (!cancelled) setPrediction(null);
      }
    };

    void loadPrediction();
    const interval = window.setInterval(() => { void loadPrediction(); }, ML_POLL_INTERVAL_MS);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, []);

  return (
    <MapContainer
      center={center}
      zoom={9}
      scrollWheelZoom
      className="w-full h-full"
      zoomControl
    >
      {/* Dark base map - CartoDB Dark Matter */}
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
      />

      {/* Live NEXRAD radar WMS overlay above base map and below strike layers */}
      <Pane name="radar-overlay" style={{ zIndex: 320 }}>
        <DebouncedRadarLayer />
      </Pane>

      <MapCenterEffect center={center} />
      <MapClickCapture onMoveMonitoredLocation={onMoveMonitoredLocation} />

      {/* Animated strike trail showing storm motion */}
      <StrikeTrail strikes={strikes} />

      {/* Storm cell + predicted zone overlay from ML */}
      {prediction && <StormCellOverlay prediction={prediction} />}

      {/* Safety radius rings (largest first so smaller ones render on top) */}
      {RADIUS_RINGS.slice().reverse().map(({ key, color }) => {
        const km = alertConfig[`${key}RadiusKm` as keyof AlertConfig] as number;
        return (
          <Circle
            key={key}
            center={center}
            radius={km * 1000}
            pathOptions={{
              color,
              fillColor: color,
              fillOpacity: 0.03,
              weight: 1,
              opacity: 0.4,
              dashArray: '6 6',
            }}
          />
        );
      })}

      {/* Plasma glow ring around monitored location */}
      <Circle
        center={center}
        radius={800}
        pathOptions={{
          color: '#00c8ff',
          fillColor: '#00c8ff',
          fillOpacity: 0.06,
          weight: 0,
        }}
      />

      {/* Per-strike source uncertainty ring (>1 km error radius only) */}
      <Pane name="strike-errors" style={{ zIndex: 420 }}>
        {strikes
          .filter((strike) => typeof strike.errorRadiusKm === 'number' && strike.errorRadiusKm > 1)
          .map((strike) => (
            <Circle
              key={`${strike.id}-error`}
              center={[strike.lat, strike.lng]}
              radius={(strike.errorRadiusKm as number) * 1000}
              pathOptions={{
                color: '#b7d8ff',
                fillColor: '#b7d8ff',
                fillOpacity: 0.07,
                opacity: 0.35,
                weight: 1,
                dashArray: '5, 5',
              }}
            />
          ))}
      </Pane>

      {/* Strike markers */}
      <Pane name="strike-points" style={{ zIndex: 430 }}>
        {strikes.map((strike) => {
          const { radius, color, opacity, dist } = strikeVisuals(strike, false, monitored);
          const isNewest = strike.id === newestStrikeId;
          const isSelected = strike.id === selectedStrikeId;
          const renderedRadius = isSelected
            ? Math.min(10, radius + 2)
            : isNewest
              ? Math.min(10, radius + 1)
              : radius;

          return (
            <CircleMarker
              key={strike.id}
              center={[strike.lat, strike.lng]}
              radius={renderedRadius}
              pathOptions={{
                color: isSelected ? '#ffffff' : color,
                fillColor: color,
                fillOpacity: 0.5,
                weight: isSelected ? 2.5 : isNewest ? 2 : 1.5,
                opacity,
              }}
              eventHandlers={{
                click: (event) => {
                  event.originalEvent.stopPropagation();
                  onSelectStrike(strike);
                },
              }}
            >
              <Popup>
                <div className="font-display text-xs space-y-1">
                  <div className="font-bold text-bolt-500">
                    ⚡ {Math.round(strike.intensityKa)} kA
                  </div>
                  <div className="text-storm-400">
                    {Math.round(dist * 10) / 10} km away
                  </div>
                  <div className="text-storm-400">
                    {strikeTypeLabel(strike.strikeType)}
                  </div>
                  <div className="text-storm-400">
                    {strike.polarity === 'positive' ? '+ Positive' : '− Negative'} discharge
                  </div>
                  <div className="text-storm-400">
                    {strikeAgeSeconds(strike)}s ago
                  </div>
                  {typeof strike.errorRadiusKm === 'number' && strike.errorRadiusKm > 0 && (
                    <div className="text-storm-400">
                      ±{strike.errorRadiusKm.toFixed(1)} km location error radius
                    </div>
                  )}
                </div>
              </Popup>
            </CircleMarker>
          );
        })}
      </Pane>

      {/* Keep monitored point crisp and above strike dots. */}
      <Pane name="monitored-point" style={{ zIndex: 700 }}>
        <CircleMarker
          center={center}
          radius={10}
          pathOptions={{
            color: '#00c8ff',
            fillColor: '#00c8ff',
            fillOpacity: 1,
            weight: 3,
            opacity: 1,
          }}
        >
          <Popup>
            <div className="font-display text-sm">
              <div className="font-bold text-plasma-500">{monitored.label}</div>
              <div className="text-storm-400 text-xs mt-0.5">Monitored location · tap map to move</div>
            </div>
          </Popup>
        </CircleMarker>
      </Pane>

      {/* Flash effect on newest strike */}
      {newestStrikeId &&
        strikes
          .filter((s) => s.id === newestStrikeId)
          .map((s) => <FlashEffect key={`flash-${s.id}`} strike={s} />)}
    </MapContainer>
  );
}
