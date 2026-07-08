// ─────────────────────────────────────────────────────────────────
// HttpLightningService
//
// ILightningService implementation that fetches data from the
// Strikewise backend API instead of generating mock data locally.
// Activated when VITE_API_URL is set in the environment.
// ─────────────────────────────────────────────────────────────────

import type {
  AlertConfig,
  ILightningService,
  LatLng,
  LightningFeedMeta,
  LightningRiskNowcast,
  LightningStrike,
  MapBounds,
  SafetyStatus,
  ThunderETAEntry,
} from './types';
import { buildSafetyStatus, buildThunderETAs } from './insights';
import { haversineKm } from './geo';

const MIN_POLL_INTERVAL_MS = 15_000;  // < 15 km — storm is very close
const MID_POLL_INTERVAL_MS = 20_000;  // 15–30 km — storm approaching
const MAX_POLL_INTERVAL_MS = 30_000;  // > 30 km — normal rate

type LightningApiPayload = {
  provider: string;
  generatedAt: number;
  strikes: LightningStrike[];
  meta: Omit<LightningFeedMeta, 'provider' | 'generatedAt'>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isLightningStrike(value: unknown): value is LightningStrike {
  if (!isRecord(value)) return false;

  return (
    typeof value.id === 'string'
    && typeof value.lat === 'number'
    && Number.isFinite(value.lat)
    && typeof value.lng === 'number'
    && Number.isFinite(value.lng)
    && typeof value.timestamp === 'number'
    && Number.isFinite(value.timestamp)
    && typeof value.intensityKa === 'number'
    && Number.isFinite(value.intensityKa)
    && (value.polarity === 'negative' || value.polarity === 'positive')
    && typeof value.multiplicity === 'number'
    && Number.isFinite(value.multiplicity)
  );
}

function parseLightningApiPayload(raw: unknown): LightningApiPayload {
  if (!isRecord(raw)) {
    throw new Error('Invalid lightning payload: expected an object');
  }

  if (typeof raw.provider !== 'string' || typeof raw.generatedAt !== 'number' || !Number.isFinite(raw.generatedAt)) {
    throw new Error('Invalid lightning payload metadata');
  }

  if (!Array.isArray(raw.strikes)) {
    throw new Error('Invalid lightning payload: strikes must be an array');
  }

  if (!raw.strikes.every((strike) => isLightningStrike(strike))) {
    throw new Error('Invalid lightning payload: malformed strike entry');
  }

  if (!isRecord(raw.meta)) {
    throw new Error('Invalid lightning payload: meta must be an object');
  }

  return {
    provider: raw.provider,
    generatedAt: raw.generatedAt,
    strikes: raw.strikes,
    meta: raw.meta as Omit<LightningFeedMeta, 'provider' | 'generatedAt'>,
  };
}

function boundsCenter(bounds: MapBounds): LatLng {
  return {
    lat: (bounds.northEast.lat + bounds.southWest.lat) / 2,
    lng: (bounds.northEast.lng + bounds.southWest.lng) / 2,
  };
}

function adaptiveIntervalMs(strikes: LightningStrike[], bounds: MapBounds): number {
  if (strikes.length === 0) return MAX_POLL_INTERVAL_MS;
  const center = boundsCenter(bounds);
  const closest = Math.min(
    ...strikes.map((s) => haversineKm(center.lat, center.lng, s.lat, s.lng)),
  );
  if (closest < 15) return MIN_POLL_INTERVAL_MS;
  if (closest < 30) return MID_POLL_INTERVAL_MS;
  return MAX_POLL_INTERVAL_MS;
}

function isValidLatitude(value: number) {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

function isValidLongitude(value: number) {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

function hasValidBounds(bounds: MapBounds) {
  const north = bounds.northEast.lat;
  const south = bounds.southWest.lat;
  const east = bounds.northEast.lng;
  const west = bounds.southWest.lng;

  return (
    isValidLatitude(north) &&
    isValidLatitude(south) &&
    isValidLongitude(east) &&
    isValidLongitude(west) &&
    north >= south &&
    east >= west
  );
}

export class HttpLightningService implements ILightningService {
  private readonly baseUrl: string;
  private _seenIds = new Set<string>();
  private _latestMeta: LightningFeedMeta | null = null;

  constructor(baseUrl: string) {
    // Strip trailing slash so all paths are consistent
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  // ── Public API ───────────────────────────────────────────────

  async getRiskNowcast(location: LatLng): Promise<LightningRiskNowcast | null> {
    const params = new URLSearchParams({
      lat: String(location.lat),
      lng: String(location.lng),
    });

    const res = await fetch(`${this.baseUrl}/api/lightning/risk?${params.toString()}`);
    if (!res.ok) {
      return null;
    }

    const raw = await res.json();
    if (!isRecord(raw)) {
      return null;
    }

    if (
      typeof raw.ready !== 'boolean'
      || typeof raw.horizonMinutes !== 'number'
      || typeof raw.radiusKm !== 'number'
      || typeof raw.lat !== 'number'
      || typeof raw.lng !== 'number'
      || typeof raw.riskLevel !== 'string'
      || typeof raw.strikeProbability !== 'number'
      || typeof raw.modelSource !== 'string'
      || typeof raw.featureCount !== 'number'
    ) {
      return null;
    }

    if (raw.riskLevel !== 'low' && raw.riskLevel !== 'moderate' && raw.riskLevel !== 'high') {
      return null;
    }

    return {
      ready: raw.ready,
      horizonMinutes: raw.horizonMinutes,
      radiusKm: raw.radiusKm,
      lat: raw.lat,
      lng: raw.lng,
      riskLevel: raw.riskLevel,
      strikeProbability: raw.strikeProbability,
      modelSource: raw.modelSource,
      featureCount: raw.featureCount,
      explanation: typeof raw.explanation === 'string' ? raw.explanation : undefined,
      drivers: Array.isArray(raw.drivers)
        ? raw.drivers.filter((value): value is string => typeof value === 'string')
        : undefined,
      asOf: typeof raw.asOf === 'string' ? raw.asOf : null,
    };
  }

  async setMonitoredPoint(location: LatLng): Promise<void> {
    await fetch(`${this.baseUrl}/api/lightning/monitored-point`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        lat: location.lat,
        lon: location.lng,
      }),
    });
  }

  async getRecentStrikes(bounds: MapBounds, minutes: number): Promise<LightningStrike[]> {
    const params = new URLSearchParams({
      minutes: String(minutes),
    });

    if (hasValidBounds(bounds)) {
      params.set('north', String(bounds.northEast.lat));
      params.set('south', String(bounds.southWest.lat));
      params.set('east', String(bounds.northEast.lng));
      params.set('west', String(bounds.southWest.lng));
    }

    const res = await fetch(`${this.baseUrl}/api/lightning?${params}`);
    if (!res.ok) throw new Error(`Lightning API responded with ${res.status}`);

    const raw = await res.json();
    const data = parseLightningApiPayload(raw);
    this._latestMeta = {
      ...data.meta,
      provider: data.provider,
      generatedAt: data.generatedAt,
    };
    for (const strike of data.strikes) {
      this._seenIds.add(strike.id);
    }
    return data.strikes;
  }

  getLatestMeta(): LightningFeedMeta | null {
    return this._latestMeta;
  }

  subscribeToLiveStrikes(
    bounds: MapBounds,
    minutes: number,
    onStrike: (strike: LightningStrike) => void,
  ): () => void {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const seenBeforePoll = new Set(this._seenIds);
        const strikes = await this.getRecentStrikes(bounds, minutes);
        if (cancelled) return;
        for (const strike of strikes) {
          if (!seenBeforePoll.has(strike.id)) {
            this._seenIds.add(strike.id);
            onStrike(strike);
          }
        }
        // Schedule next poll at an interval proportional to storm proximity
        const nextMs = adaptiveIntervalMs(strikes, bounds);
        timer = setTimeout(poll, nextMs);
      } catch {
        // Network errors are non-fatal; retry at normal rate
        if (!cancelled) timer = setTimeout(poll, MAX_POLL_INTERVAL_MS);
      }
    };

    // Kick off shortly after mount to avoid startup race
    timer = setTimeout(poll, 500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }

  getSafetyStatus(
    location: LatLng,
    strikes: LightningStrike[],
    config: AlertConfig,
    feedMeta?: LightningFeedMeta | null,
  ): SafetyStatus {
    const baseStatus = buildSafetyStatus(location, strikes, config, feedMeta);

    if (strikes.length === 0) {
      return {
        ...baseStatus,
        level: 'safe',
        recommendation: 'No nearby strikes detected. Conditions look clear for now.',
      };
    }

    const hasStrikeWithinRadius = strikes.some((strike) =>
      haversineKm(location.lat, location.lng, strike.lat, strike.lng) <= config.cautionRadiusKm,
    );

    if (hasStrikeWithinRadius && baseStatus.level === 'caution') {
      return {
        ...baseStatus,
        level: 'warning',
        colorHex: '#ff8800',
        recommendation: 'Lightning detected within your monitored radius. Move indoors now.',
      };
    }

    return baseStatus;
  }

  getThunderETAs(location: LatLng, strikes: LightningStrike[]): ThunderETAEntry[] {
    return buildThunderETAs(location, strikes);
  }
}
