// ─────────────────────────────────────────────────────────────────
// Open-Meteo Lightning Provider
//
// Uses Open-Meteo's free forecast API with `lightning_potential`
// (a 0–100 dimensionless index per hour for a given lat/lng).
// Since Open-Meteo gives potential scores — not individual strike
// positions — this provider generates spatially distributed
// estimated strikes proportional to the current-hour potential.
//
// API docs: https://open-meteo.com/en/docs
// No API key required.
// ─────────────────────────────────────────────────────────────────

import { createHash } from 'crypto';
import { z } from 'zod';

import type {
  LightningProvider,
  LightningQuery,
  LightningResponse,
  LightningStrike,
} from '../types/lightning.js';

const BASE_URL = 'https://api.open-meteo.com/v1/forecast';

// Max strikes to generate when potential = 100
const MAX_STRIKES_PER_HOUR = 40;

interface OpenMeteoResponse {
  latitude: number;
  longitude: number;
  hourly: {
    time: string[];                  // ISO8601 hour strings
    lightning_potential: Array<number | null>;   // 0–100 per hour
  };
}

const openMeteoResponseSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  hourly: z.object({
    time: z.array(z.string()),
    lightning_potential: z.array(z.number().nullable()),
  }),
});

/** Derive a lat/lng center from the query bounds, or fall back to a default. */
function centerFromQuery(query: LightningQuery): { lat: number; lng: number } {
  if (query.bounds) {
    return {
      lat: (query.bounds.north + query.bounds.south) / 2,
      lng: (query.bounds.east + query.bounds.west) / 2,
    };
  }
  // No bounds provided — use a default that will be overridden in practice
  // because useLightningFeed always supplies the user's location.
  return { lat: 39.5, lng: -98.35 }; // geographic center of contiguous US
}

/** Spread (degrees) within which to scatter estimated strikes. */
function spreadFromQuery(query: LightningQuery): { latSpread: number; lngSpread: number } {
  if (query.bounds) {
    return {
      latSpread: (query.bounds.north - query.bounds.south) / 2,
      lngSpread: (query.bounds.east - query.bounds.west) / 2,
    };
  }
  return { latSpread: 0.5, lngSpread: 0.5 }; // ~55 km default radius
}

/** Seeded pseudo-random (deterministic per hour+index so IDs are stable). */
function pseudoRandom(seed: number): number {
  const x = Math.sin(seed) * 43758.5453123;
  return x - Math.floor(x);
}

function parseUtcHour(hour: string): number {
  // Open-Meteo hourly strings are usually timezone-naive (e.g. 2026-05-11T14:00).
  // Interpret them as UTC unless an explicit timezone suffix is present.
  const hasTzSuffix = /(?:[zZ]|[+-]\d{2}:\d{2})$/.test(hour);
  const value = hasTzSuffix ? Date.parse(hour) : Date.parse(`${hour}Z`);
  return Number.isFinite(value) ? value : NaN;
}

/** Build estimated strikes for a given hour potential (0–100). */
function buildStrikes(
  potential: number,
  hourIndex: number,
  center: { lat: number; lng: number },
  spread: { latSpread: number; lngSpread: number },
  windowStartMs: number,
  windowEndMs: number,
): LightningStrike[] {
  const durationMs = Math.max(0, windowEndMs - windowStartMs);
  if (potential < 5 || durationMs <= 0) return [];

  const overlapRatio = Math.min(1, durationMs / (60 * 60 * 1000));
  const count = Math.round((potential / 100) * MAX_STRIKES_PER_HOUR * overlapRatio);
  const strikes: LightningStrike[] = [];

  for (let i = 0; i < count; i++) {
    const seed = hourIndex * 1000 + i;
    const rLat = (pseudoRandom(seed) - 0.5) * 2 * spread.latSpread;
    const rLng = (pseudoRandom(seed + 0.5) - 0.5) * 2 * spread.lngSpread;
    const rTime = pseudoRandom(seed + 1) * durationMs;

    const lat = center.lat + rLat;
    const lng = center.lng + rLng;
    const timestamp = windowStartMs + rTime;

    const id = createHash('sha1')
      .update(`open-meteo:${windowStartMs}:${windowEndMs}:${i}`)
      .digest('hex')
      .slice(0, 16);

    const intensityKa = 10 + pseudoRandom(seed + 2) * 80; // 10–90 kA
    const polarity: 'negative' | 'positive' =
      pseudoRandom(seed + 3) > 0.85 ? 'positive' : 'negative';

    strikes.push({ id, lat, lng, timestamp, intensityKa, polarity, multiplicity: 1 });
  }

  return strikes;
}

export class OpenMeteoProvider implements LightningProvider {
  async getRecentStrikes(query: LightningQuery): Promise<LightningResponse> {
    const center = centerFromQuery(query);
    const spread = spreadFromQuery(query);

    const params = new URLSearchParams({
      latitude: String(center.lat),
      longitude: String(center.lng),
      hourly: 'lightning_potential',
      forecast_days: '1',
      timezone: 'UTC',
    });

    const url = `${BASE_URL}?${params}`;
    const res = await fetch(url);

    if (!res.ok) {
      throw new Error(`Open-Meteo API responded with ${res.status}`);
    }

    const raw = await res.json();
    const parsed = openMeteoResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error('Invalid Open-Meteo response payload');
    }
    const data: OpenMeteoResponse = parsed.data;
    const { time, lightning_potential } = data.hourly;

    // Find which hours fall within the query window (now − minutes → now)
    const now = Date.now();
    const windowMs = query.minutes * 60 * 1000;
    const cutoff = now - windowMs;

    const strikes: LightningStrike[] = [];
    let maxPotential = 0;

    for (let i = 0; i < time.length; i++) {
      const hourEpochMs = parseUtcHour(time[i]);
      if (!Number.isFinite(hourEpochMs)) continue;
      const nextHourMs = hourEpochMs + 60 * 60 * 1000;

      // Include this hour if it overlaps with the query window
      if (nextHourMs < cutoff || hourEpochMs > now) continue;

      const windowStartMs = Math.max(hourEpochMs, cutoff);
      const windowEndMs = Math.min(nextHourMs, now);

      const potential = Math.max(0, lightning_potential[i] ?? 0);
      if (potential > maxPotential) maxPotential = potential;

      const hourStrikes = buildStrikes(
        potential,
        i,
        center,
        spread,
        windowStartMs,
        windowEndMs,
      );
      strikes.push(...hourStrikes);
    }

    const currentHourIdx = time.findIndex((t) => {
      const ms = parseUtcHour(t);
      return ms <= now && ms + 60 * 60 * 1000 > now;
    });
    const currentPotential =
      currentHourIdx >= 0 ? (lightning_potential[currentHourIdx] ?? 0) : 0;

    return {
      provider: 'open-meteo',
      generatedAt: now,
      strikes,
      meta: {
        simulated: true,
        source: 'open-meteo-lightning-potential',
        providerStatus: 'ok',
        notes: [
          `Lightning potential index: ${Math.round(currentPotential)}/100 (current hour)`,
          `Open-Meteo gives storm probability, not observed bolt positions.`,
          `Estimated ${strikes.length} strikes from ${Math.round(maxPotential)}% peak potential.`,
        ],
      },
    };
  }
}
