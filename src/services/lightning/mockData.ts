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

const LOOP_DURATION_MS = 3 * 60 * 1000;
const STRIKE_LIFETIME_MS = 10 * 60 * 1000;
const FRAME_INTERVAL_MS = 2500;

const CORRIDOR_START = { lat: 33.05, lng: -97.45 };
const CORRIDOR_END = { lat: 32.45, lng: -96.35 };

// ─────────────────────────────────────────────────────────────────
// Strike generator helpers
// ─────────────────────────────────────────────────────────────────

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

function lerp(start: number, end: number, t: number) {
  return start + (end - start) * t;
}

function stormRamp(phase: number) {
  // Triangle wave: 0 -> 1 -> 0 over a 3-minute loop.
  return phase < 0.5 ? phase * 2 : (1 - phase) * 2;
}

function corridorPoint(phase: number) {
  return {
    lat: lerp(CORRIDOR_START.lat, CORRIDOR_END.lat, phase),
    lng: lerp(CORRIDOR_START.lng, CORRIDOR_END.lng, phase),
  };
}

function stormCenter(phase: number) {
  const along = (phase + 0.08 * Math.sin(phase * Math.PI * 2)) % 1;
  const point = corridorPoint(along);
  // Slight lateral wobble keeps frames dynamic while preserving a corridor path.
  const wobbleKm = 5 * Math.sin(phase * Math.PI * 6);
  return {
    lat: point.lat + kmToLatDeg(wobbleKm),
    lng: point.lng + kmToLngDeg(wobbleKm * 0.4, point.lat),
  };
}

function burstCount(phase: number) {
  const ramp = stormRamp(phase);
  if (ramp > 0.9) return 5;
  if (ramp > 0.75) return 4;
  if (ramp > 0.55) return 3;
  if (ramp > 0.3) return 2;
  if (ramp > 0.12) return 1;
  return 0;
}

export function createStormLoopFrame(
  indexStart: number,
  now = Date.now(),
): { strikes: LightningStrike[]; nextIndex: number; frameIntervalMs: number } {
  const phase = (now % LOOP_DURATION_MS) / LOOP_DURATION_MS;
  const ramp = stormRamp(phase);
  const center = stormCenter(phase);
  const freshCount = burstCount(phase);
  let nextIndex = indexStart;

  const strikes: LightningStrike[] = [];

  if (freshCount === 0) {
    // Keep the feed moving with distant, old strikes during calm phases.
    strikes.push(randomStrike(center, 70, randBetween(8 * 60 * 1000, 9.5 * 60 * 1000), nextIndex));
    nextIndex += 1;
  } else {
    for (let i = 0; i < freshCount; i += 1) {
      const spreadKm = 7 + ramp * 10;
      // Calm phases emit older strikes; peak phases emit fresh strikes.
      const ageMs = randBetween((1 - ramp) * 8 * 60 * 1000, (1 - ramp) * 9.5 * 60 * 1000);
      const strike = randomStrike(center, spreadKm, ageMs, nextIndex);
      strikes.push(strike);
      nextIndex += 1;
    }
  }

  return {
    strikes,
    nextIndex,
    frameIntervalMs: FRAME_INTERVAL_MS,
  };
}

export { STRIKE_LIFETIME_MS };
