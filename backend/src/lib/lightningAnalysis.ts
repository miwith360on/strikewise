import { getBoundsCenter, haversineKm, isPointInBounds } from './geo.js';
import type {
  BoundingBox,
  LightningMeta,
  LightningQuery,
  LightningResponse,
  LightningResultState,
  LightningStrike,
  LightningTrend,
} from '../types/lightning.js';

const STALE_THRESHOLD_SECONDS = 15 * 60;
const TREND_WINDOW_MS = 10 * 60 * 1000;
const ALL_CLEAR_WINDOW_MS = 30 * 60 * 1000;
const ACTIVE_WINDOW_MS = 10 * 60 * 1000;

function isFiniteCoordinate(value: number) {
  return Number.isFinite(value) && Math.abs(value) <= 180;
}

function isValidStrike(strike: LightningStrike) {
  return (
    strike.id.length > 0 &&
    isFiniteCoordinate(strike.lat) &&
    isFiniteCoordinate(strike.lng) &&
    Number.isFinite(strike.timestamp) &&
    strike.timestamp > 0 &&
    Number.isFinite(strike.intensityKa) &&
    strike.intensityKa >= 0
  );
}

function dedupeAndFilterStrikes(strikes: LightningStrike[], bounds?: BoundingBox) {
  const now = Date.now();
  const latestById = new Map<string, LightningStrike>();
  let filteredCount = 0;

  for (const strike of strikes) {
    if (!isValidStrike(strike)) {
      filteredCount += 1;
      continue;
    }

    if (strike.timestamp > now + 30_000) {
      filteredCount += 1;
      continue;
    }

    if (bounds && !isPointInBounds(strike.lat, strike.lng, bounds)) {
      filteredCount += 1;
      continue;
    }

    const existing = latestById.get(strike.id);
    if (!existing || strike.timestamp > existing.timestamp) {
      if (existing) {
        filteredCount += 1;
      }
      latestById.set(strike.id, strike);
    } else {
      filteredCount += 1;
    }
  }

  return {
    strikes: [...latestById.values()].sort((left, right) => right.timestamp - left.timestamp),
    filteredCount,
  };
}

function getAnalysisRadiusKm(bounds?: BoundingBox) {
  if (!bounds) {
    return null;
  }

  const center = getBoundsCenter(bounds);
  const corners = [
    { lat: bounds.north, lng: bounds.east },
    { lat: bounds.north, lng: bounds.west },
    { lat: bounds.south, lng: bounds.east },
    { lat: bounds.south, lng: bounds.west },
  ];

  return Math.max(...corners.map((corner) => haversineKm(center.lat, center.lng, corner.lat, corner.lng)));
}

function averageDistanceKm(center: { lat: number; lng: number }, strikes: LightningStrike[]) {
  if (strikes.length === 0) {
    return Infinity;
  }

  const total = strikes.reduce(
    (sum, strike) => sum + haversineKm(center.lat, center.lng, strike.lat, strike.lng),
    0,
  );
  return total / strikes.length;
}

function getTrend(strikes: LightningStrike[], bounds?: BoundingBox): LightningTrend {
  if (!bounds || strikes.length < 4) {
    return 'unknown';
  }

  const center = getBoundsCenter(bounds);
  const now = Date.now();
  const recent = strikes.filter((strike) => now - strike.timestamp <= TREND_WINDOW_MS);
  const previous = strikes.filter((strike) => {
    const ageMs = now - strike.timestamp;
    return ageMs > TREND_WINDOW_MS && ageMs <= TREND_WINDOW_MS * 2;
  });

  if (recent.length < 2 || previous.length < 2) {
    return 'unknown';
  }

  const recentAverage = averageDistanceKm(center, recent);
  const previousAverage = averageDistanceKm(center, previous);

  if (recentAverage <= previousAverage - 2) {
    return 'approaching';
  }

  if (recentAverage >= previousAverage + 2) {
    return 'departing';
  }

  return 'steady';
}

function getAllClearMinutesRemaining(strikes: LightningStrike[], bounds?: BoundingBox, analysisRadiusKm?: number | null) {
  if (!bounds || !analysisRadiusKm) {
    return 0;
  }

  const center = getBoundsCenter(bounds);
  const now = Date.now();
  const nearbyRecent = strikes
    .filter((strike) => now - strike.timestamp <= ALL_CLEAR_WINDOW_MS)
    .filter((strike) => haversineKm(center.lat, center.lng, strike.lat, strike.lng) <= analysisRadiusKm);

  if (nearbyRecent.length === 0) {
    return 0;
  }

  const latestNearbyStrike = nearbyRecent.reduce(
    (latest, strike) => Math.max(latest, strike.timestamp),
    0,
  );

  return Math.max(0, Math.ceil((ALL_CLEAR_WINDOW_MS - (now - latestNearbyStrike)) / 60000));
}

function getClosestStrikeKm(strikes: LightningStrike[], bounds?: BoundingBox) {
  if (!bounds || strikes.length === 0) {
    return null;
  }

  const center = getBoundsCenter(bounds);
  const closest = Math.min(
    ...strikes.map((strike) => haversineKm(center.lat, center.lng, strike.lat, strike.lng)),
  );

  return Math.round(closest * 10) / 10;
}

function getStrikeCountLast10min(strikes: LightningStrike[]) {
  const now = Date.now();
  return strikes.filter((strike) => now - strike.timestamp <= ACTIVE_WINDOW_MS).length;
}

function getResultState(strikes: LightningStrike[], freshnessSeconds: number | null): LightningResultState {
  if (strikes.length === 0) {
    return 'empty';
  }

  if (freshnessSeconds !== null && freshnessSeconds > STALE_THRESHOLD_SECONDS) {
    return 'stale';
  }

  return 'active';
}

function getDataQualityScore(meta: LightningMeta, resultState: LightningResultState, filteredCount: number) {
  let score = meta.simulated ? 55 : 88;

  if (meta.providerStatus === 'degraded') {
    score -= 18;
  }

  if (resultState === 'stale') {
    score -= 20;
  }

  if (resultState === 'empty') {
    score -= 4;
  }

  if (filteredCount > 0) {
    score -= Math.min(10, filteredCount);
  }

  return Math.max(0, Math.min(100, score));
}

export function enrichLightningResponse(
  query: LightningQuery,
  payload: LightningResponse,
  options?: { cached?: boolean; cacheAgeSeconds?: number },
): LightningResponse {
  const { strikes, filteredCount } = dedupeAndFilterStrikes(payload.strikes, query.bounds);
  const latestStrikeTimestamp = strikes[0]?.timestamp;
  const latestStrikeAgeSeconds = latestStrikeTimestamp
    ? Math.max(0, Math.round((payload.generatedAt - latestStrikeTimestamp) / 1000))
    : null;
  const freshnessSeconds = latestStrikeAgeSeconds;
  const analysisRadiusKm = getAnalysisRadiusKm(query.bounds);
  const trend = getTrend(strikes, query.bounds);
  const resultState = getResultState(strikes, freshnessSeconds);
  const providerStatus = payload.meta.providerStatus ?? 'ok';
  const allClearMinutesRemaining = getAllClearMinutesRemaining(strikes, query.bounds, analysisRadiusKm);
  const closestStrikeKm = getClosestStrikeKm(strikes, query.bounds);
  const strikeCountLast10min = getStrikeCountLast10min(strikes);
  const notes = [...(payload.meta.notes ?? [])];

  if (filteredCount > 0) {
    notes.push(`Filtered ${filteredCount} duplicate or invalid strike records before analysis.`);
  }

  if (resultState === 'empty') {
    notes.push('Provider responded successfully, but no strikes matched this query window.');
  }

  if (resultState === 'stale') {
    notes.push('Newest strike in this response is older than the stale-data threshold.');
  }

  const meta: LightningMeta = {
    ...payload.meta,
    providerStatus,
    resultState,
    cached: options?.cached ?? false,
    cacheAgeSeconds: options?.cacheAgeSeconds ?? 0,
    freshnessSeconds,
    latestStrikeAgeSeconds,
    trend,
    allClearMinutesRemaining,
    closestStrikeKm,
    strikeCountLast10min,
    dataQualityScore: getDataQualityScore({ ...payload.meta, providerStatus }, resultState, filteredCount),
    queryMinutes: query.minutes,
    analysisRadiusKm,
    normalizedStrikeCount: strikes.length,
    filteredStrikeCount: filteredCount,
    notes,
  };

  return {
    ...payload,
    strikes,
    meta,
  };
}