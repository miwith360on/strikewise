import type {
  AlertConfig,
  LatLng,
  LightningStrike,
  SafetyStatus,
  ThunderETAEntry,
} from './types';
import { haversineKm } from './mockData';

export const SOUND_SPEED_KM_S = 0.343;
export const ACTIVE_WINDOW_MINUTES = 10;
export const ALL_CLEAR_WINDOW_MINUTES = 30;
export const ACTIVE_WINDOW_MS = ACTIVE_WINDOW_MINUTES * 60 * 1000;
export const ALL_CLEAR_WINDOW_MS = ALL_CLEAR_WINDOW_MINUTES * 60 * 1000;

function roundKm(distanceKm: number): number {
  return Math.round(distanceKm * 10) / 10;
}

function averageDistanceKm(location: LatLng, strikes: LightningStrike[]): number {
  if (strikes.length === 0) {
    return Infinity;
  }

  const total = strikes.reduce(
    (sum, strike) => sum + haversineKm(location.lat, location.lng, strike.lat, strike.lng),
    0,
  );

  return total / strikes.length;
}

function getTrend(location: LatLng, strikes: LightningStrike[]): SafetyStatus['changeRate'] {
  const now = Date.now();
  const recentWindow = strikes.filter((strike) => now - strike.timestamp <= ACTIVE_WINDOW_MS);
  const previousWindow = strikes.filter((strike) => {
    const ageMs = now - strike.timestamp;
    return ageMs > ACTIVE_WINDOW_MS && ageMs <= ACTIVE_WINDOW_MS * 2;
  });

  if (recentWindow.length < 2 || previousWindow.length < 2) {
    return 'steady';
  }

  const recentAverage = averageDistanceKm(location, recentWindow);
  const previousAverage = averageDistanceKm(location, previousWindow);

  if (recentAverage <= previousAverage - 2) {
    return 'approaching';
  }

  if (recentAverage >= previousAverage + 2) {
    return 'departing';
  }

  return 'steady';
}

export function formatThunderEtaRange(etaSeconds: number): string {
  if (etaSeconds <= 15) return 'Now';
  if (etaSeconds <= 60) return 'Under 1 min';
  if (etaSeconds <= 120) return '1-2 min';
  if (etaSeconds <= 300) return '2-5 min';
  if (etaSeconds <= 600) return '5-10 min';
  return '10+ min';
}

export function buildThunderETAs(location: LatLng, strikes: LightningStrike[]): ThunderETAEntry[] {
  const recent = strikes.filter((strike) => Date.now() - strike.timestamp < ALL_CLEAR_WINDOW_MS);

  return recent
    .map((strike): ThunderETAEntry => {
      const distanceKm = haversineKm(location.lat, location.lng, strike.lat, strike.lng);
      const travelTimeSec = distanceKm / SOUND_SPEED_KM_S;
      const ageAtLocationSec = (Date.now() - strike.timestamp) / 1000;
      const etaSeconds = travelTimeSec - ageAtLocationSec;

      return {
        strikeId: strike.id,
        distanceKm,
        etaSeconds,
        etaRangeLabel: formatThunderEtaRange(etaSeconds),
        intensityKa: strike.intensityKa,
        lat: strike.lat,
        lng: strike.lng,
      };
    })
    .filter((entry) => entry.etaSeconds > -5)
    .sort((left, right) => left.etaSeconds - right.etaSeconds)
    .slice(0, 5);
}

export function buildSafetyStatus(
  location: LatLng,
  strikes: LightningStrike[],
  config: AlertConfig,
): SafetyStatus {
  const now = Date.now();
  const tracked = strikes.filter((strike) => now - strike.timestamp < ALL_CLEAR_WINDOW_MS);
  const active = tracked.filter((strike) => now - strike.timestamp < ACTIVE_WINDOW_MS);

  const trackedDistances = tracked.map((strike) =>
    haversineKm(location.lat, location.lng, strike.lat, strike.lng),
  );
  const activeDistances = active.map((strike) =>
    haversineKm(location.lat, location.lng, strike.lat, strike.lng),
  );
  const closestTracked = trackedDistances.length > 0 ? Math.min(...trackedDistances) : Infinity;
  const closestActive = activeDistances.length > 0 ? Math.min(...activeDistances) : Infinity;
  const nearbyTracked = tracked.filter((strike) =>
    haversineKm(location.lat, location.lng, strike.lat, strike.lng) <= config.cautionRadiusKm,
  );
  const lastNearbyStrike = nearbyTracked.reduce<number | null>((latest, strike) => {
    if (latest === null || strike.timestamp > latest) {
      return strike.timestamp;
    }
    return latest;
  }, null);

  const allClearMinutesRemaining = lastNearbyStrike === null
    ? 0
    : Math.max(
        0,
        Math.ceil((ALL_CLEAR_WINDOW_MS - (now - lastNearbyStrike)) / 60000),
      );

  const changeRate = getTrend(location, tracked);

  let level: SafetyStatus['level'];
  if (closestActive <= config.dangerRadiusKm) level = 'danger';
  else if (closestActive <= config.warningRadiusKm) level = 'warning';
  else if (closestActive <= config.cautionRadiusKm || allClearMinutesRemaining > 0) level = 'caution';
  else level = 'safe';

  const recommendation = level === 'danger'
    ? 'Lightning is very close. Get inside and stay away from windows.'
    : level === 'warning'
      ? 'Storm danger is building nearby. Head indoors now.'
      : level === 'caution' && allClearMinutesRemaining > 0 && closestActive > config.cautionRadiusKm
        ? `Wait ${allClearMinutesRemaining} more min after the last nearby strike before going back out.`
        : level === 'caution'
          ? 'Lightning is nearby. Stay close to shelter and keep watching conditions.'
          : 'No nearby lightning in the last 30 minutes. Conditions look clear for now.';

  const colorHex = level === 'danger'
    ? '#ff3333'
    : level === 'warning'
      ? '#ff8800'
      : level === 'caution'
        ? '#ffe033'
        : '#00e676';

  return {
    level,
    closestStrikeKm: isFinite(closestTracked) ? roundKm(closestTracked) : 999,
    strikeCountLast10min: active.length,
    changeRate,
    recommendation,
    colorHex,
    allClearMinutesRemaining,
  };
}