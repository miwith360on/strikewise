import type { LightningStrike, MonitoredLocation } from './types';

// ─────────────────────────────────────────────────────────────────
// Seeded pseudo-random number generator for deterministic dev seeds
// ─────────────────────────────────────────────────────────────────
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(0xdeadbeef);

function randBetween(min: number, max: number) {
  return min + rng() * (max - min);
}

// ─────────────────────────────────────────────────────────────────
// Default monitored location — Dallas / Fort Worth, TX
// (prime storm corridor; good demo geography)
// ─────────────────────────────────────────────────────────────────
export const DEFAULT_LOCATION: MonitoredLocation = {
  id: 'loc-dfw',
  label: 'Dallas, TX',
  lat: 32.7767,
  lng: -96.797,
};

// ─────────────────────────────────────────────────────────────────
// Strike generator helpers
// ─────────────────────────────────────────────────────────────────

/** Haversine distance between two lat/lng points in kilometres */
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Convert kilometres to approximate degrees latitude */
function kmToLatDeg(km: number): number {
  return km / 111.32;
}

/** Convert kilometres to approximate degrees longitude at a given latitude */
function kmToLngDeg(km: number, lat: number): number {
  return km / (111.32 * Math.cos((lat * Math.PI) / 180));
}

/** Generate a single strike at up to `maxRadiusKm` from `center` */
export function randomStrike(
  center: { lat: number; lng: number },
  maxRadiusKm: number,
  ageMs: number,
  index: number,
): LightningStrike {
  const angle = rng() * Math.PI * 2;
  // Bias towards closer strikes for realistic cluster feel
  const distance = maxRadiusKm * Math.pow(rng(), 0.6);
  const lat = center.lat + kmToLatDeg(distance) * Math.cos(angle);
  const lng = center.lng + kmToLngDeg(distance, center.lat) * Math.sin(angle);

  return {
    id: `mock-${index}-${Date.now()}`,
    lat,
    lng,
    timestamp: Date.now() - ageMs,
    intensityKa: randBetween(8, 120),
    polarity: rng() > 0.15 ? 'negative' : 'positive',
    multiplicity: Math.floor(randBetween(1, 5)),
  };
}

// ─────────────────────────────────────────────────────────────────
// Initial seed batch — 30 strikes spread over the last 10 minutes
// ─────────────────────────────────────────────────────────────────
export function generateSeedStrikes(
  center: { lat: number; lng: number },
  count = 30,
  maxRadiusKm = 50,
): LightningStrike[] {
  return Array.from({ length: count }, (_, i) =>
    randomStrike(center, maxRadiusKm, randBetween(0, 10 * 60 * 1000), i),
  );
}

// ─────────────────────────────────────────────────────────────────
// A new live strike (called periodically)
// ─────────────────────────────────────────────────────────────────
export function generateLiveStrike(
  center: { lat: number; lng: number },
  index: number,
): LightningStrike {
  // 30 % chance the strike is close (within 15 km) — keeps things interesting
  const close = rng() < 0.3;
  return randomStrike(center, close ? 15 : 50, 0, index);
}
