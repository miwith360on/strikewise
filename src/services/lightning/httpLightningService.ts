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
  LightningStrike,
  MapBounds,
  SafetyStatus,
  ThunderETAEntry,
} from './types';
import { buildSafetyStatus, buildThunderETAs } from './insights';

const POLL_INTERVAL_MS = 10_000;

export class HttpLightningService implements ILightningService {
  private readonly baseUrl: string;
  private _seenIds = new Set<string>();
  private _latestMeta: LightningFeedMeta | null = null;

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

    const data = await res.json() as {
      provider: string;
      generatedAt: number;
      strikes: LightningStrike[];
      meta: Omit<LightningFeedMeta, 'provider' | 'generatedAt'>;
    };
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
    const poll = async () => {
      try {
        const strikes = await this.getRecentStrikes(bounds, minutes);
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
    feedMeta?: LightningFeedMeta | null,
  ): SafetyStatus {
    return buildSafetyStatus(location, strikes, config, feedMeta);
  }

  getThunderETAs(location: LatLng, strikes: LightningStrike[]): ThunderETAEntry[] {
    return buildThunderETAs(location, strikes);
  }
}
