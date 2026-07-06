import type { Request } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { enrichLightningResponse } from '../lib/lightningAnalysis.js';
import type { BlitzortungFeedStrike, BlitzortungProvider } from '../lib/blitzortungProvider.js';
import { createLightningProvider } from '../providers/index.js';
import type { BoundingBox, LightningQuery, LightningResponse } from '../types/lightning.js';

const CACHE_TTL_MS = 45_000;
const CACHE_MAX_ENTRIES = 500;
const provider = createLightningProvider();
const responseCache = new Map<string, { cachedAt: number; payload: LightningResponse }>();
const inflightRequests = new Map<string, Promise<LightningResponse>>();

function pruneCache() {
  const now = Date.now();
  for (const [key, entry] of responseCache) {
    if (now - entry.cachedAt > CACHE_TTL_MS * 8) {
      responseCache.delete(key);
    }
  }
  // Hard cap: evict oldest entries if still over limit
  if (responseCache.size > CACHE_MAX_ENTRIES) {
    const sorted = [...responseCache.entries()].sort((a, b) => a[1].cachedAt - b[1].cachedAt);
    for (const [key] of sorted.slice(0, responseCache.size - CACHE_MAX_ENTRIES)) {
      responseCache.delete(key);
    }
  }
}

const querySchema = z.object({
  north: z.coerce.number().optional(),
  south: z.coerce.number().optional(),
  east: z.coerce.number().optional(),
  west: z.coerce.number().optional(),
  minutes: z.coerce.number().int().min(1).max(60).default(10),
});

const monitoredPointSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
});

const riskQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

function buildBounds(query: z.infer<typeof querySchema>): BoundingBox | undefined {
  if (
    query.north === undefined ||
    query.south === undefined ||
    query.east === undefined ||
    query.west === undefined
  ) {
    return undefined;
  }

  return {
    north: query.north,
    south: query.south,
    east: query.east,
    west: query.west,
  };
}

export const lightningRouter = Router();

function getBlitz(request: Request): BlitzortungProvider | null {
  const locals = request.app.locals as { blitz?: BlitzortungProvider };
  return locals.blitz ?? null;
}

function toApiStrike(strike: BlitzortungFeedStrike) {
  const peakCurrentKa = typeof strike.peakCurrentKa === 'number'
    ? strike.peakCurrentKa
    : null;

  return {
    id: strike.id,
    lat: strike.lat,
    lng: strike.lon,
    timestamp: strike.timestamp,
    intensityKa: peakCurrentKa === null ? 0 : Math.abs(peakCurrentKa),
    polarity: (typeof strike.polarity === 'number' && strike.polarity > 0) ? 'positive' as const : 'negative' as const,
    multiplicity: 1,
    strikeType: 'unknown' as const,
    peakCurrentKa,
  };
}

function filterBlitzStrikes(
  strikes: BlitzortungFeedStrike[],
  query: LightningQuery,
) {
  const cutoff = Date.now() - query.minutes * 60_000;

  return strikes
    .filter((strike) => strike.timestamp >= cutoff)
    .filter((strike) => {
      if (!query.bounds) {
        return true;
      }

      return (
        strike.lat >= query.bounds.south
        && strike.lat <= query.bounds.north
        && strike.lon >= query.bounds.west
        && strike.lon <= query.bounds.east
      );
    });
}

function toQueryKey(query: LightningQuery) {
  return JSON.stringify({
    north: query.bounds?.north ?? null,
    south: query.bounds?.south ?? null,
    east: query.bounds?.east ?? null,
    west: query.bounds?.west ?? null,
    minutes: query.minutes,
  });
}

async function fetchMlRisk(lat: number, lng: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.ML_REQUEST_TIMEOUT_MS);

  try {
    const params = new URLSearchParams({
      lat: String(lat),
      lng: String(lng),
    });
    const response = await fetch(`${env.ML_SERVICE_URL}/ml/risk?${params.toString()}`, {
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`ML service responded ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function getCachedOrFetch(query: LightningQuery, cacheKey: string): Promise<{
  payload: LightningResponse;
  cached: boolean;
  cachedAt: number;
}> {
  const now = Date.now();
  const cachedEntry = responseCache.get(cacheKey);
  if (cachedEntry && now - cachedEntry.cachedAt < CACHE_TTL_MS) {
    return {
      payload: cachedEntry.payload,
      cached: true,
      cachedAt: cachedEntry.cachedAt,
    };
  }

  const existingInflight = inflightRequests.get(cacheKey);
  if (existingInflight) {
    const payload = await existingInflight;
    const refreshed = responseCache.get(cacheKey);
    return {
      payload,
      cached: true,
      cachedAt: refreshed?.cachedAt ?? Date.now(),
    };
  }

  const requestPromise = (async () => {
    const freshPayload = await provider.getRecentStrikes(query);
    responseCache.set(cacheKey, { cachedAt: Date.now(), payload: freshPayload });
    pruneCache();
    return freshPayload;
  })();

  inflightRequests.set(cacheKey, requestPromise);

  try {
    const payload = await requestPromise;
    const refreshed = responseCache.get(cacheKey);
    return {
      payload,
      cached: false,
      cachedAt: refreshed?.cachedAt ?? Date.now(),
    };
  } catch (error) {
    // Reliability fallback: serve stale data if upstream is temporarily failing.
    if (cachedEntry) {
      return {
        payload: cachedEntry.payload,
        cached: true,
        cachedAt: cachedEntry.cachedAt,
      };
    }
    throw error;
  } finally {
    inflightRequests.delete(cacheKey);
  }
}

lightningRouter.get('/', async (request, response, next) => {
  try {
    const query = querySchema.parse(request.query);
    const normalizedQuery = {
      bounds: buildBounds(query),
      minutes: query.minutes,
    };
    const cacheKey = toQueryKey(normalizedQuery);
    const blitz = getBlitz(request);

    if (blitz?.getHealth().state === 'LIVE') {
      const blitzHealth = blitz.getHealth();
      const blitzStrikes = filterBlitzStrikes(blitz.getStrikes(), normalizedQuery).map(toApiStrike);
      const payload: LightningResponse = {
        provider: 'blitzortung',
        generatedAt: Date.now(),
        strikes: blitzStrikes,
        meta: {
          simulated: false,
          source: 'blitzortung-live-ws-primary',
          providerStatus: 'ok',
          notes: [
            'Blitzortung LIVE primary feed in use.',
            `Buffered strikes: ${blitzHealth.bufferedStrikes}`,
          ],
        },
      };

      const analyzedPayload = enrichLightningResponse(normalizedQuery, payload, {
        cached: false,
        cacheAgeSeconds: 0,
      });

      response.json(analyzedPayload);
      return;
    }

    let payload: LightningResponse;
    let cacheState: { cached: boolean; cachedAt: number } = { cached: false, cachedAt: Date.now() };
    try {
      const result = await getCachedOrFetch(normalizedQuery, cacheKey);
      payload = result.payload;
      cacheState = { cached: result.cached, cachedAt: result.cachedAt };
    } catch (providerError) {
      const msg = providerError instanceof Error ? providerError.message : 'Provider error';
      payload = {
        provider: 'error',
        generatedAt: Date.now(),
        strikes: [],
        meta: {
          simulated: false,
          source: 'provider-error',
          providerStatus: 'degraded',
          notes: [`Provider failed: ${msg}`],
        },
      };
    }

    const blitzHealth = blitz?.getHealth();
    if (blitzHealth && payload.provider !== 'blitzortung') {
      payload = {
        ...payload,
        meta: {
          ...payload.meta,
          notes: [
            `Blitzortung ${blitzHealth.state}; using fallback provider path.`,
            ...(payload.meta.notes ?? []),
          ],
        },
      };
    }

    const analyzedPayload = enrichLightningResponse(
      normalizedQuery,
      payload,
      cacheState.cached
        ? {
            cached: true,
            cacheAgeSeconds: Math.max(0, Math.round((Date.now() - cacheState.cachedAt) / 1000)),
          }
        : {
            cached: false,
            cacheAgeSeconds: 0,
          },
    );

    response.json(analyzedPayload);
  } catch (error) {
    next(error);
  }
});

lightningRouter.post('/monitored-point', (request, response, next) => {
  try {
    const body = monitoredPointSchema.parse(request.body);
    const blitz = getBlitz(request);

    if (!blitz) {
      response.status(503).json({
        error: 'Blitzortung provider is not initialized',
      });
      return;
    }

    blitz.setMonitoredPoint(body.lat, body.lon);
    const health = blitz.getHealth();

    response.json({
      ok: true,
      monitoredPoint: body,
      blitzState: health.state,
    });
  } catch (error) {
    next(error);
  }
});

lightningRouter.get('/risk', async (request, response, next) => {
  try {
    const query = riskQuerySchema.parse(request.query);
    const risk = await fetchMlRisk(query.lat, query.lng);
    response.json(risk);
  } catch (error) {
    next(error);
  }
});
