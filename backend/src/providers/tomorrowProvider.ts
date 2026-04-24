// ─────────────────────────────────────────────────────────────────
// Tomorrow.io Lightning Provider
//
// Calls the Tomorrow.io Timelines API for `lightningFlashRateDensity`
// (flashes per minute per km²) at the query center point.
// Because Tomorrow.io gives a rate scalar — not individual strike
// positions — this provider generates spatially distributed
// estimated strikes proportional to the flash rate, clearly
// marked as simulated: true.
//
// Docs: https://docs.tomorrow.io/reference/post-timelines
// Requires env var: TOMORROW_API_KEY
// ─────────────────────────────────────────────────────────────────

import { createHash } from 'crypto';

import { env } from '../config/env.js';
import type {
  LightningProvider,
  LightningQuery,
  LightningResponse,
  LightningStrike,
} from '../types/lightning.js';

const BASE_URL = 'https://api.tomorrow.io/v4/timelines';

// At 1 flash/min/km², generate this many strikes per minute in the window
const STRIKES_PER_FLASH_RATE_PER_MIN = 8;
// Hard cap regardless of flash rate
const MAX_STRIKES = 60;

interface TomorrowInterval {
  startTime: string;
  values: {
    lightningFlashRateDensity?: number; // flashes / 5 min / km²
  };
}

interface TomorrowTimeline {
  timestep: string;
  startTime: string;
  endTime: string;
  intervals: TomorrowInterval[];
}

interface TomorrowResponse {
  data: {
    timelines: TomorrowTimeline[];
  };
}

function centerFromQuery(query: LightningQuery): { lat: number; lng: number } {
  if (query.bounds) {
    return {
      lat: (query.bounds.north + query.bounds.south) / 2,
      lng: (query.bounds.east + query.bounds.west) / 2,
    };
  }
  return { lat: 39.5, lng: -98.35 };
}

function spreadFromQuery(query: LightningQuery): { latSpread: number; lngSpread: number } {
  if (query.bounds) {
    return {
      latSpread: (query.bounds.north - query.bounds.south) / 2,
      lngSpread: (query.bounds.east - query.bounds.west) / 2,
    };
  }
  return { latSpread: 0.5, lngSpread: 0.5 };
}

function pseudoRandom(seed: number): number {
  const x = Math.sin(seed + 1) * 43758.5453123;
  return x - Math.floor(x);
}

function buildStrikes(
  flashRate: number,
  intervalIndex: number,
  intervalEpochMs: number,
  windowMs: number,
  center: { lat: number; lng: number },
  spread: { latSpread: number; lngSpread: number },
): LightningStrike[] {
  if (flashRate <= 0) return [];

  const windowMinutes = windowMs / 60_000;
  const rawCount = Math.round(flashRate * STRIKES_PER_FLASH_RATE_PER_MIN * windowMinutes);
  const count = Math.min(rawCount, MAX_STRIKES);
  const strikes: LightningStrike[] = [];

  for (let i = 0; i < count; i++) {
    const seed = intervalIndex * 500 + i;
    const rLat = (pseudoRandom(seed) - 0.5) * 2 * spread.latSpread;
    const rLng = (pseudoRandom(seed + 0.5) - 0.5) * 2 * spread.lngSpread;
    const rTime = pseudoRandom(seed + 1) * windowMs;

    const id = createHash('sha1')
      .update(`tomorrow:${intervalEpochMs}:${i}`)
      .digest('hex')
      .slice(0, 16);

    strikes.push({
      id,
      lat: center.lat + rLat,
      lng: center.lng + rLng,
      timestamp: intervalEpochMs + rTime,
      intensityKa: 10 + pseudoRandom(seed + 2) * 80,
      polarity: pseudoRandom(seed + 3) > 0.85 ? 'positive' : 'negative',
      multiplicity: 1,
    });
  }

  return strikes;
}

export class TomorrowProvider implements LightningProvider {
  async getRecentStrikes(query: LightningQuery): Promise<LightningResponse> {
    const apiKey = env.TOMORROW_API_KEY;
    if (!apiKey) {
      throw new Error('TOMORROW_API_KEY is not set');
    }

    const center = centerFromQuery(query);
    const spread = spreadFromQuery(query);

    const now = new Date();
    const startTime = new Date(Date.now() - query.minutes * 60 * 1000).toISOString();
    const endTime = now.toISOString();

    const body = {
      location: `${center.lat},${center.lng}`,
      fields: ['lightningFlashRateDensity'],
      units: 'metric',
      timesteps: ['1m'],
      startTime,
      endTime,
    };

    const res = await fetch(`${BASE_URL}?apikey=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Tomorrow.io API error ${res.status}: ${text.slice(0, 200)}`);
    }

    const data = await res.json() as TomorrowResponse;
    const timelines = data?.data?.timelines ?? [];
    const timeline = timelines.find((t) => t.timestep === '1m') ?? timelines[0];
    const intervals = timeline?.intervals ?? [];

    const strikes: LightningStrike[] = [];
    let maxFlashRate = 0;
    let currentFlashRate = 0;

    intervals.forEach((interval, idx) => {
      const rate = interval.values.lightningFlashRateDensity ?? 0;
      if (rate > maxFlashRate) maxFlashRate = rate;

      const intervalMs = new Date(interval.startTime).getTime();
      const isCurrentInterval = idx === intervals.length - 1;
      if (isCurrentInterval) currentFlashRate = rate;

      const windowMs = 60_000; // 1-min intervals
      strikes.push(...buildStrikes(rate, idx, intervalMs, windowMs, center, spread));
    });

    return {
      provider: 'tomorrow',
      generatedAt: Date.now(),
      strikes,
      meta: {
        simulated: true,
        source: 'tomorrow-io-lightning-flash-rate',
        providerStatus: 'ok',
        notes: [
          `Lightning flash rate: ${currentFlashRate.toFixed(3)} flashes/min/km² (latest interval)`,
          `Peak flash rate: ${maxFlashRate.toFixed(3)} flashes/min/km²`,
          `Tomorrow.io provides flash rate scalars — strike positions are estimated.`,
          `${strikes.length} estimated strikes generated from ${intervals.length} intervals.`,
        ],
      },
    };
  }
}
