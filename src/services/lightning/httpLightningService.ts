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
  LightningStrike,
  MapBounds,
  SafetyLevel,
  SafetyStatus,
  ThunderETAEntry,
} from './types';
import { haversineKm } from './mockData';

const SOUND_SPEED_KM_S = 0.343;
const RETENTION_MS = 10 * 60 * 1000;
const POLL_INTERVAL_MS = 10_000;

export class HttpLightningService implements ILightningService {
  private readonly baseUrl: string;
  private _seenIds = new Set<string>();

  constructor(baseUrl: string) {
    // Strip trailing slash so all paths are consistent
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  // ── Public API ───────────────────────────────────────────────

  async getRecentStrikes(bounds: MapBounds, minutes: number): Promise<LightningStrike[]> {
    const params = new URLSearchParams({
      north: String(bounds.northEast.lat),
      south: String(bounds.southWest.lat),
      east: String(bounds.northEast.lng),
      west: String(bounds.southWest.lng),
      minutes: String(minutes),
    });

    const res = await fetch(`${this.baseUrl}/api/lightning?${params}`);
    if (!res.ok) throw new Error(`Lightning API responded with ${res.status}`);

    const data = await res.json() as { strikes: LightningStrike[] };
    return data.strikes;
  }

  subscribeToLiveStrikes(
    bounds: MapBounds,
    onStrike: (strike: LightningStrike) => void,
  ): () => void {
    this._seenIds.clear();

    const poll = async () => {
      try {
        const strikes = await this.getRecentStrikes(bounds, 10);
        for (const strike of strikes) {
          if (!this._seenIds.has(strike.id)) {
            this._seenIds.add(strike.id);
            onStrike(strike);
          }
        }
      } catch {
        // Network errors are non-fatal during polling; retry next interval
      }
    };

    // Kick off immediately (short delay to avoid startup race) then every interval
    const timeout = setTimeout(poll, 500);
    const interval = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }

  getSafetyStatus(
    location: LatLng,
    strikes: LightningStrike[],
    config: AlertConfig,
  ): SafetyStatus {
    const recent = strikes.filter((s) => Date.now() - s.timestamp < RETENTION_MS);

    if (recent.length === 0) {
      return this._buildStatus('safe', Infinity, 0, 'steady', config);
    }

    const distances = recent.map((s) =>
      haversineKm(location.lat, location.lng, s.lat, s.lng),
    );
    const closest = Math.min(...distances);
    const count = recent.length;

    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    const recent5 = recent.filter((s) => s.timestamp > fiveMinAgo).length;
    const older5 = count - recent5;
    const changeRate =
      recent5 > older5 + 2 ? 'increasing' : recent5 < older5 - 2 ? 'decreasing' : 'steady';

    let level: SafetyLevel;
    if (closest <= config.dangerRadiusKm) level = 'danger';
    else if (closest <= config.warningRadiusKm) level = 'warning';
    else if (closest <= config.cautionRadiusKm) level = 'caution';
    else level = 'safe';

    return this._buildStatus(level, closest, count, changeRate, config);
  }

  getThunderETAs(location: LatLng, strikes: LightningStrike[]): ThunderETAEntry[] {
    const recent = strikes.filter((s) => Date.now() - s.timestamp < RETENTION_MS);

    return recent
      .map((s): ThunderETAEntry => {
        const distanceKm = haversineKm(location.lat, location.lng, s.lat, s.lng);
        const travelTimeSec = distanceKm / SOUND_SPEED_KM_S;
        const ageAtLocationSec = (Date.now() - s.timestamp) / 1000;
        const etaSeconds = travelTimeSec - ageAtLocationSec;

        return {
          strikeId: s.id,
          distanceKm,
          etaSeconds,
          intensityKa: s.intensityKa,
          lat: s.lat,
          lng: s.lng,
        };
      })
      .filter((e) => e.etaSeconds > -5)
      .sort((a, b) => a.etaSeconds - b.etaSeconds)
      .slice(0, 5);
  }

  // ── Private helpers ──────────────────────────────────────────

  private _buildStatus(
    level: SafetyLevel,
    closestKm: number,
    count: number,
    changeRate: 'increasing' | 'decreasing' | 'steady',
    config: AlertConfig,
  ): SafetyStatus {
    const messages: Record<SafetyLevel, string> = {
      danger: `Lightning within ${config.dangerRadiusKm} km — seek shelter immediately`,
      warning: `Active storm within ${config.warningRadiusKm} km — move indoors`,
      caution: `Storm approaching — monitor conditions closely`,
      safe: `No lightning detected within ${config.cautionRadiusKm} km`,
    };

    const colors: Record<SafetyLevel, string> = {
      danger: '#ff3333',
      warning: '#ff8800',
      caution: '#ffe033',
      safe: '#00e676',
    };

    return {
      level,
      closestStrikeKm: isFinite(closestKm) ? Math.round(closestKm * 10) / 10 : 999,
      strikeCountLast10min: count,
      changeRate,
      recommendation: messages[level],
      colorHex: colors[level],
    };
  }
}
