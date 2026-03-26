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
  LightningStrike,
  MapBounds,
  SafetyLevel,
  SafetyStatus,
  ThunderETAEntry,
} from './types';
import {
  DEFAULT_LOCATION,
  generateLiveStrike,
  generateSeedStrikes,
  haversineKm,
} from './mockData';
import { HttpLightningService } from './httpLightningService';

// Speed of sound at sea level in km/s
const SOUND_SPEED_KM_S = 0.343;

// Prune strikes older than this
const RETENTION_MS = 10 * 60 * 1000;

let strikeCounter = 1000;

class MockLightningService implements ILightningService {
  private _strikes: LightningStrike[] = [];

  constructor() {
    // Pre-populate with a realistic spread
    this._strikes = generateSeedStrikes(DEFAULT_LOCATION, 32, 50);
  }

  // ── Public API ───────────────────────────────────────────────

  async getRecentStrikes(_bounds: MapBounds, _minutes: number): Promise<LightningStrike[]> {
    return this._getFiltered();
  }

  subscribeToLiveStrikes(
    _bounds: MapBounds,
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

    // Compare to 5 minutes ago to determine trend
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
      .filter((e) => e.etaSeconds > -5) // discard thunder already passed
      .sort((a, b) => a.etaSeconds - b.etaSeconds)
      .slice(0, 5);
  }

  // ── Private helpers ──────────────────────────────────────────

  private _getFiltered(): LightningStrike[] {
    this._prune();
    return [...this._strikes];
  }

  private _prune() {
    const cutoff = Date.now() - RETENTION_MS;
    this._strikes = this._strikes.filter((s) => s.timestamp > cutoff);
  }

  private _nextInterval(): number {
    // Random between 2 000 and 4 500 ms
    return 2000 + Math.random() * 2500;
  }

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

// ─────────────────────────────────────────────────────────────────
// Singleton export
//
// In production, default to the same-origin API so a single Railway
// service can host both the dashboard and backend. VITE_API_URL can
// still override this for split deployments.
// ─────────────────────────────────────────────────────────────────
const configuredApiUrl = import.meta.env.VITE_API_URL?.trim();
const apiUrl = configuredApiUrl || (import.meta.env.PROD ? window.location.origin : undefined);

export const lightningService: ILightningService = apiUrl
  ? new HttpLightningService(apiUrl)
  : new MockLightningService();

export { DEFAULT_LOCATION };
