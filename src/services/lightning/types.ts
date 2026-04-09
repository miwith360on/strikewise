// ─────────────────────────────────────────────────────────────────
// Lightning Intelligence — Core Domain Types
// Replace the mock service with a real API adapter without changing
// the rest of the app; all consumers depend only on these types.
// ─────────────────────────────────────────────────────────────────

export interface LatLng {
  lat: number;
  lng: number;
}

/** A single cloud-to-ground or cloud-to-cloud lightning discharge */
export interface LightningStrike {
  id: string;
  lat: number;
  lng: number;
  /** Unix timestamp in milliseconds */
  timestamp: number;
  /** Peak current in kiloamperes (absolute value) */
  intensityKa: number;
  polarity: 'negative' | 'positive';
  /** Flash multiplicity — number of return strokes */
  multiplicity: number;
}

/** Geographic bounding box for map queries */
export interface MapBounds {
  northEast: LatLng;
  southWest: LatLng;
}

/** The location the user is monitoring (home, job site, event, etc.) */
export interface MonitoredLocation {
  id: string;
  label: string;
  lat: number;
  lng: number;
}

// ── Thunder ETA ───────────────────────────────────────────────────

export interface ThunderETAEntry {
  strikeId: string;
  distanceKm: number;
  /** Seconds until thunder arrives at the monitored location (negative = already heard) */
  etaSeconds: number;
  etaRangeLabel: string;
  intensityKa: number;
  lat: number;
  lng: number;
}

// ── Safety ────────────────────────────────────────────────────────

export type FeedStatus = 'connecting' | 'live' | 'unavailable' | 'demo';
export type SafetyLevel = 'safe' | 'caution' | 'warning' | 'danger';
export type SafetyTrend = 'approaching' | 'departing' | 'steady';

export interface SafetyStatus {
  level: SafetyLevel;
  closestStrikeKm: number;
  strikeCountLast10min: number;
  changeRate: SafetyTrend;
  recommendation: string;
  colorHex: string;
  allClearMinutesRemaining: number;
}

// ── Alert Config ──────────────────────────────────────────────────

export interface AlertConfig {
  dangerRadiusKm: number;
  warningRadiusKm: number;
  cautionRadiusKm: number;
  soundEnabled: boolean;
  vibrationEnabled: boolean;
  /** Minimum interval between repeat alerts in seconds */
  repeatIntervalSec: number;
  monitored: MonitoredLocation;
}

// ── Service interface (adapter contract) ─────────────────────────

/**
 * ILightningService — the contract every data adapter must implement.
 * Swap MockLightningService for a real API class (Vaisala, Blitzortung,
 * Tomorrow.io, etc.) without touching any component.
 */
export interface ILightningService {
  /** Fetch strikes within the given bounds from the last `minutes` minutes */
  getRecentStrikes(bounds: MapBounds, minutes: number): Promise<LightningStrike[]>;

  /**
   * Subscribe to a live strike feed. Returns an unsubscribe function.
   * The callback is invoked each time a new strike is detected.
   */
  subscribeToLiveStrikes(
    bounds: MapBounds,
    minutes: number,
    onStrike: (strike: LightningStrike) => void,
  ): () => void;

  /** Compute safety status for a location given current strikes */
  getSafetyStatus(location: LatLng, strikes: LightningStrike[], config: AlertConfig): SafetyStatus;

  /** Compute the closest incoming thunder ETA entries, sorted by ETA ascending */
  getThunderETAs(location: LatLng, strikes: LightningStrike[]): ThunderETAEntry[];
}
