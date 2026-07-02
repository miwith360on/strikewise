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
  createStormLoopFrame,
  DEFAULT_LOCATION,
  generateSeedStrikes,
  STRIKE_LIFETIME_MS,
} from './mockData';
import { HttpLightningService } from './httpLightningService';

let strikeCounter = 1000;

class MockLightningService implements ILightningService {
  private _strikes: LightningStrike[] = [];
  private _latestMeta: LightningFeedMeta | null = null;

  constructor() {
    // Pre-populate with recent history so strike colors and safety transitions are visible.
    this._strikes = generateSeedStrikes(DEFAULT_LOCATION, 18, 42);
  }

  // ── Public API ───────────────────────────────────────────────

  async setMonitoredPoint(_location: LatLng): Promise<void> {
    // Mock mode has no backend state to synchronize.
  }

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
    let timer: ReturnType<typeof setTimeout> | null = null;

    const emitFrame = () => {
      this._prune();
      const frame = createStormLoopFrame(strikeCounter);
      strikeCounter = frame.nextIndex;
      for (const strike of frame.strikes) {
        this._strikes.push(strike);
        onStrike(strike);
      }

      timer = setTimeout(emitFrame, frame.frameIntervalMs);
    };

    // Emit new storm frames every few seconds for an evolving demo loop.
    emitFrame();

    return () => {
      if (timer) {
        clearTimeout(timer);
      }
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

  // ── Private helpers ──────────────────────────────────────────

  private _getFiltered(): LightningStrike[] {
    this._prune();
    return [...this._strikes];
  }

  private _prune() {
    const cutoff = Date.now() - STRIKE_LIFETIME_MS;
    this._strikes = this._strikes.filter((s) => s.timestamp > cutoff);
  }

}

// ─────────────────────────────────────────────────────────────────
// Singleton export
//
// Use live data by default. Demo mode can be forced with ?demo=1 for
// product previews, and remains automatic in local dev when no API URL is set.
// ─────────────────────────────────────────────────────────────────
const configuredApiUrl = import.meta.env.VITE_API_URL?.trim();
const forceDemoFromQuery = typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).get('demo') === '1';
const forceDemoFromEnv = import.meta.env.VITE_FORCE_DEMO === '1';
const useDemoMode = forceDemoFromQuery || forceDemoFromEnv;
const apiUrl = configuredApiUrl && configuredApiUrl.length > 0 ? configuredApiUrl : '';

export const lightningServiceMode: 'demo' | 'live' = useDemoMode ? 'demo' : 'live';

export const lightningService: ILightningService = useDemoMode
  ? new MockLightningService()
  : new HttpLightningService(apiUrl);

export { DEFAULT_LOCATION };
export { ACTIVE_WINDOW_MINUTES, ALL_CLEAR_WINDOW_MS, ALL_CLEAR_WINDOW_MINUTES };
