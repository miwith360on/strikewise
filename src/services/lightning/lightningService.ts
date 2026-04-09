// ─────────────────────────────────────────────────────────────────
// MockLightningService
//
// Implements ILightningService with realistic simulated data.
// To integrate a real provider (Vaisala, Blitzortung, Tomorrow.io,
// AWS Environmental Intelligence, etc.):
//
//   1. Create `RealLightningService` implementing ILightningService
//   2. Replace the instantiation in lightningService.ts
//   3. All hooks and components continue working unchanged.
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
import {
  ACTIVE_WINDOW_MINUTES,
  ALL_CLEAR_WINDOW_MS,
  ALL_CLEAR_WINDOW_MINUTES,
  buildSafetyStatus,
  buildThunderETAs,
} from './insights';
import {
  DEFAULT_LOCATION,
  generateLiveStrike,
  generateSeedStrikes,
} from './mockData';
import { HttpLightningService } from './httpLightningService';

let strikeCounter = 1000;

class MockLightningService implements ILightningService {
  private _strikes: LightningStrike[] = [];
  private _latestMeta: LightningFeedMeta | null = null;

  constructor() {
    // Pre-populate with a realistic spread
    this._strikes = generateSeedStrikes(DEFAULT_LOCATION, 32, 50);
  }

  // ── Public API ───────────────────────────────────────────────

  async getRecentStrikes(_bounds: MapBounds, _minutes: number): Promise<LightningStrike[]> {
    const strikes = this._getFiltered();
    const latestStrikeAgeSeconds = strikes[0]
      ? Math.max(0, Math.round((Date.now() - strikes[0].timestamp) / 1000))
      : null;

    this._latestMeta = {
      simulated: true,
      source: 'mock-generator',
      provider: 'mock',
      generatedAt: Date.now(),
      providerStatus: 'ok',
      resultState: strikes.length > 0 ? 'active' : 'empty',
      cached: false,
      cacheAgeSeconds: 0,
      freshnessSeconds: latestStrikeAgeSeconds,
      latestStrikeAgeSeconds,
      trend: 'unknown',
      allClearMinutesRemaining: 0,
      closestStrikeKm: null,
      strikeCountLast10min: strikes.length,
      dataQualityScore: 55,
      queryMinutes: ALL_CLEAR_WINDOW_MINUTES,
      normalizedStrikeCount: strikes.length,
      filteredStrikeCount: 0,
      notes: ['Demo mode only'],
    };

    return strikes;
  }

  getLatestMeta(): LightningFeedMeta | null {
    return this._latestMeta;
  }

  subscribeToLiveStrikes(
    _bounds: MapBounds,
    _minutes: number,
    onStrike: (strike: LightningStrike) => void,
  ): () => void {
    // Emit a new strike every 2–5 seconds (realistic storm frequency)
    const interval = setInterval(() => {
      this._prune();
      const strike = generateLiveStrike(DEFAULT_LOCATION, strikeCounter++);
      this._strikes.push(strike);
      onStrike(strike);
    }, this._nextInterval());

    return () => clearInterval(interval);
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

  // ── Private helpers ──────────────────────────────────────────

  private _getFiltered(): LightningStrike[] {
    this._prune();
    return [...this._strikes];
  }

  private _prune() {
    const cutoff = Date.now() - ALL_CLEAR_WINDOW_MS;
    this._strikes = this._strikes.filter((s) => s.timestamp > cutoff);
  }

  private _nextInterval(): number {
    // Random between 2 000 and 4 500 ms
    return 2000 + Math.random() * 2500;
  }
}

// ─────────────────────────────────────────────────────────────────
// Singleton export
//
// Use demo data only in local development without an API override.
// Production always targets the backend API so real-feed failures are visible.
// ─────────────────────────────────────────────────────────────────
const configuredApiUrl = import.meta.env.VITE_API_URL?.trim();
const useDemoMode = !import.meta.env.PROD && (!configuredApiUrl || configuredApiUrl.length === 0);
const apiUrl = configuredApiUrl && configuredApiUrl.length > 0 ? configuredApiUrl : '';

export const lightningServiceMode: 'demo' | 'live' = useDemoMode ? 'demo' : 'live';

export const lightningService: ILightningService = useDemoMode
  ? new MockLightningService()
  : new HttpLightningService(apiUrl);

export { DEFAULT_LOCATION };
export { ACTIVE_WINDOW_MINUTES, ALL_CLEAR_WINDOW_MS, ALL_CLEAR_WINDOW_MINUTES };
