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

import { env } from '../config/env.js';
import type {
  BoundingBox,
  LightningProvider,
  LightningQuery,
  LightningResponse,
  LightningStrike,
} from '../types/lightning.js';

interface XWeatherObservation {
  id: string;
  loc: { lat: number; long: number };
  ob: {
    timestamp: number;         // Unix seconds
    peakamp?: number;          // Peak current in kA (signed: negative = negative polarity)
    type?: string;             // "CG" | "IC" | etc.
    count?: number;            // Flash multiplicity
  };
}

interface XWeatherResponse {
  success: boolean;
  error?: { code: string; description: string };
  response?: XWeatherObservation[];
}

const BASE_URL = 'https://api.xweather.com';

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

    const data = await res.json() as XWeatherResponse;

    if (!data.success) {
      const msg = data.error?.description ?? 'Unknown xWeather error';
      throw new Error(`xWeather API error: ${msg}`);
    }

    const observations = data.response ?? [];
    const strikes: LightningStrike[] = observations.map((obs) =>
      this._toStrike(obs),
    );

    return {
      provider: 'xweather',
      generatedAt: Date.now(),
      strikes,
      meta: {
        simulated: false,
        source: 'xweather-lightning-api',
        notes: [`${strikes.length} strikes from xWeather observations`],
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
    const minutes = query.minutes ?? 10;
    const from = `-${minutes}minutes`;

    if (query.bounds) {
      return this._withinBounds(query.bounds, from, auth);
    }

    // Default: search globally for recent flashes (last N minutes)
    return `${BASE_URL}/lightning/search?query=type:CG&from=${from}&limit=100&${auth}`;
  }

  private _withinBounds(box: BoundingBox, from: string, auth: string): string {
    // xWeather accepts a bounding box as "swLat,swLng,neLat,neLng"
    const bbox = `${box.south},${box.west},${box.north},${box.east}`;
    return `${BASE_URL}/lightning/within?p=${bbox}&from=${from}&limit=100&${auth}`;
  }

  private _toStrike(obs: XWeatherObservation): LightningStrike {
    const peakAmp = obs.ob.peakamp ?? 0;
    return {
      id: obs.id ?? `xw-${obs.ob.timestamp}-${obs.loc.lat}-${obs.loc.long}`,
      lat: obs.loc.lat,
      lng: obs.loc.long,
      timestamp: obs.ob.timestamp * 1000, // seconds → ms
      intensityKa: Math.abs(peakAmp),
      polarity: peakAmp >= 0 ? 'positive' : 'negative',
      multiplicity: obs.ob.count ?? 1,
    };
  }
}
