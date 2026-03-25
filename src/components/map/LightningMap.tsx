import { useEffect, useRef } from 'react';
import {
  Circle,
  CircleMarker,
  MapContainer,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import type {
  AlertConfig,
  LatLng,
  LightningStrike,
  MonitoredLocation,
} from '@/services/lightning/types';
import { haversineKm } from '@/services/lightning/mockData';

// ── Map auto-centering ────────────────────────────────────────────
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

// ── Strike age → visual properties ───────────────────────────────
function strikeVisuals(strike: LightningStrike, isNewest: boolean, monitored: MonitoredLocation) {
  const ageMs = Date.now() - strike.timestamp;
  const ageFraction = Math.min(ageMs / (10 * 60 * 1000), 1); // 0 = fresh, 1 = 10 min old
  const dist = haversineKm(monitored.lat, monitored.lng, strike.lat, strike.lng);

  // Radius: 4–10 px based on intensity
  const radius = 4 + (strike.intensityKa / 120) * 6;

  // Color: yellow → orange → dim red as strike ages
  let color: string;
  if (ageFraction < 0.15) color = isNewest ? '#ffffff' : '#ffe033';
  else if (ageFraction < 0.4) color = '#ffb300';
  else if (ageFraction < 0.7) color = '#ff6600';
  else color = '#992200';

  const opacity = 0.9 - ageFraction * 0.5;

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
  const center: [number, number] = [monitored.lat, monitored.lng];

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

      <MapCenterEffect center={center} />
      <MapClickCapture onMoveMonitoredLocation={onMoveMonitoredLocation} />

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

      {/* Monitored location marker */}
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

      {/* Strike markers */}
      {strikes.map((strike) => {
        const { radius, color, opacity, dist } = strikeVisuals(strike, false, monitored);
        const isNewest = strike.id === newestStrikeId;
        const isSelected = strike.id === selectedStrikeId;

        return (
          <CircleMarker
            key={strike.id}
            center={[strike.lat, strike.lng]}
            radius={isSelected ? radius * 1.9 : isNewest ? radius * 1.6 : radius}
            pathOptions={{
              color: isSelected ? '#ffffff' : color,
              fillColor: color,
              fillOpacity: isSelected ? 1 : isNewest ? 1 : opacity * 0.7,
              weight: isSelected ? 3 : isNewest ? 2 : 1,
              opacity: isSelected ? 1 : isNewest ? 1 : opacity,
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
                  {strike.polarity === 'positive' ? '+ Positive' : '− Negative'} discharge
                </div>
                <div className="text-storm-400">
                  {Math.round((Date.now() - strike.timestamp) / 1000)}s ago
                </div>
              </div>
            </Popup>
          </CircleMarker>
        );
      })}

      {/* Flash effect on newest strike */}
      {newestStrikeId &&
        strikes
          .filter((s) => s.id === newestStrikeId)
          .map((s) => <FlashEffect key={`flash-${s.id}`} strike={s} />)}
    </MapContainer>
  );
}
