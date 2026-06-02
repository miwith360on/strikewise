// ─────────────────────────────────────────────────────────────────
// xWeather Lightning Provider
//
// Calls the Aeris Weather / xWeather lightning observations API.
// Docs: https://www.xweather.com/docs/weather-api/endpoints/lightning
//
// Requires env vars:
//   XWEATHER_CLIENT_ID
//   XWEATHER_CLIENT_SECRET
// ─────────────────────────────────────────────────────────────────

import { z } from 'zod';
import { env } from '../config/env.js';
import { getBoundsCenter, haversineKm } from '../lib/geo.js';
import type {
  BoundingBox,
  LightningProvider,
  LightningQuery,
  LightningResponse,
  LightningStrike,
} from '../types/lightning.js';

const xWeatherObservationSchema = z.object({
  id: z.string().optional(),
  loc: z.object({
    lat: z.number(),
    long: z.number(),
  }),
  ob: z
    .object({
      age: z.number().optional(),
      pulse: z
        .object({
          type: z.string().optional(),
          peakamp: z.number().optional(),
        })
        .passthrough()
        .optional(),
      timestamp: z.number().optional(),
      peakamp: z.number().optional(),
      type: z.string().optional(),
      count: z.number().optional(),
    })
    .passthrough(),
});

const xWeatherResponseSchema = z.object({
  success: z.boolean(),
  error: z
    .object({
      code: z.string(),
      description: z.string(),
    })
    .optional(),
  response: z.array(xWeatherObservationSchema).optional(),
});

type XWeatherObservation = z.infer<typeof xWeatherObservationSchema>;
type XWeatherResponse = z.infer<typeof xWeatherResponseSchema>;

const BASE_URL = 'https://api.aerisapi.com';
const ACTIVE_STRIKE_MAX_AGE_SECONDS = 600;
const FRESH_STRIKE_MAX_AGE_SECONDS = 120;
const KM_PER_MILE = 1.60934;

function getNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0) {
      return candidate;
    }
  }

  return null;
}

function extractErrorRadiusKm(ob: XWeatherObservation['ob']): number | undefined {
  const obRecord = ob as Record<string, unknown>;

  const kmDirect = getNumber(obRecord, [
    'errorRadiusKm',
    'error_radius_km',
    'locErrorKm',
    'locerrkm',
    'errorkm',
    'errkm',
  ]);
  if (kmDirect !== null) {
    return kmDirect;
  }

  const meters = getNumber(obRecord, ['errorRadiusM', 'error_radius_m', 'locErrorM', 'errorm', 'errm']);
  if (meters !== null) {
    return meters / 1000;
  }

  const miles = getNumber(obRecord, ['errorRadiusMi', 'error_radius_mi', 'errorRadiusMiles', 'locErrorMi', 'errormi']);
  if (miles !== null) {
    return miles * KM_PER_MILE;
  }

  const generic = getNumber(obRecord, ['errorRadius', 'error_radius', 'locError', 'locerr', 'error', 'err']);
  if (generic !== null) {
    // xWeather precision fields are typically in km when the unit suffix is omitted.
    return generic;
  }

  return undefined;
}

export class XWeatherProvider implements LightningProvider {
  async getRecentStrikes(query: LightningQuery): Promise<LightningResponse> {
    const { XWEATHER_CLIENT_ID: id, XWEATHER_CLIENT_SECRET: secret } = env;

    if (!id || !secret) {
      throw new Error('XWEATHER_CLIENT_ID and XWEATHER_CLIENT_SECRET must be set');
    }

    const endpoint = this._buildEndpoint(query, id, secret);
    const res = await fetch(endpoint);

    if (!res.ok) {
      throw new Error(`xWeather API HTTP error: ${res.status}`);
    }

    const raw = await res.json();
    const parsed = xWeatherResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error('Invalid xWeather response payload');
    }
    const data: XWeatherResponse = parsed.data;

    if (!data.success) {
      const msg = data.error?.description ?? 'Unknown xWeather error';
      throw new Error(`xWeather API error: ${msg}`);
    }

    const observations = data.response ?? [];
    const strikes: LightningStrike[] = observations.map((obs) =>
      this._toStrike(obs),
    );
    const activeStrikeCount = observations.filter((strike) => (strike.ob.age ?? Number.MAX_SAFE_INTEGER) <= ACTIVE_STRIKE_MAX_AGE_SECONDS).length;
    const freshStrikeCount = observations.filter((strike) => (strike.ob.age ?? Number.MAX_SAFE_INTEGER) <= FRESH_STRIKE_MAX_AGE_SECONDS).length;
    const precisionCount = strikes.filter((strike) => typeof strike.errorRadiusKm === 'number').length;

    return {
      provider: 'xweather',
      generatedAt: Date.now(),
      strikes,
      meta: {
        simulated: false,
        source: 'xweather-lightning-api',
        providerStatus: 'ok',
        resultState: observations.length === 0 ? 'empty' : 'active',
        strikeCountLast10min: activeStrikeCount,
        notes: [
          `${strikes.length} strikes parsed from xWeather lightning/closest response array`,
          `${freshStrikeCount} strikes are fresh (ob.age <= 120s), ${Math.max(0, strikes.length - freshStrikeCount)} are aging`,
          `${precisionCount} strikes include source precision/error-radius metadata`,
        ],
      },
    };
  }

  // ── Private helpers ──────────────────────────────────────────

  private _buildEndpoint(
    query: LightningQuery,
    id: string,
    secret: string,
  ): string {
    const auth = `client_id=${encodeURIComponent(id)}&client_secret=${encodeURIComponent(secret)}`;
    if (query.bounds) {
      return this._closestInBounds(query.bounds, auth);
    }

    return `${BASE_URL}/lightning/closest?p=39.8283,-98.5795&radius=500mi&limit=500&${auth}`;
  }

  private _closestInBounds(box: BoundingBox, auth: string): string {
    const center = getBoundsCenter(box);
    const cornerRadiusKm = haversineKm(center.lat, center.lng, box.north, box.east);
    const radiusKm = Math.max(1, Math.ceil(cornerRadiusKm));
    return `${BASE_URL}/lightning/closest?p=${center.lat},${center.lng}&radius=${radiusKm}km&limit=500&${auth}`;
  }

  private _toStrike(obs: XWeatherObservation): LightningStrike {
    const rawPeakAmp = obs.ob.pulse?.peakamp ?? obs.ob.peakamp;
    const peakAmp = rawPeakAmp ?? 0;
    const fallbackAgeSeconds = obs.ob.timestamp !== undefined
      ? Math.max(0, Math.round(Date.now() / 1000) - obs.ob.timestamp)
      : 0;
    const strikeAgeSeconds = Math.max(0, obs.ob.age ?? fallbackAgeSeconds);
    const strikeTypeRaw = (obs.ob.pulse?.type ?? obs.ob.type ?? '').toLowerCase();
    const strikeType = strikeTypeRaw === 'cg' || strikeTypeRaw === 'ic' ? strikeTypeRaw : 'unknown';
    const timestampMs = obs.ob.age !== undefined
      ? Date.now() - strikeAgeSeconds * 1000
      : (obs.ob.timestamp ?? Math.floor(Date.now() / 1000)) * 1000;

    return {
      id: obs.id ?? `xw-${timestampMs}-${obs.loc.lat}-${obs.loc.long}`,
      lat: obs.loc.lat,
      lng: obs.loc.long,
      timestamp: timestampMs,
      intensityKa: Math.abs(peakAmp ?? 0),
      polarity: rawPeakAmp === undefined ? 'negative' : rawPeakAmp >= 0 ? 'positive' : 'negative',
      multiplicity: obs.ob.count ?? 1,
      ageSeconds: strikeAgeSeconds,
      strikeType,
      peakAmpKa: peakAmp,
      errorRadiusKm: extractErrorRadiusKm(obs.ob),
    };
  }
}
