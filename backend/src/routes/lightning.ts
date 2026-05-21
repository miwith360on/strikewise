import { Router } from 'express';
import { z } from 'zod';
import { enrichLightningResponse } from '../lib/lightningAnalysis.js';
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

function toQueryKey(query: LightningQuery) {
  return JSON.stringify({
    north: query.bounds?.north ?? null,
    south: query.bounds?.south ?? null,
    east: query.bounds?.east ?? null,
    west: query.bounds?.west ?? null,
    minutes: query.minutes,
  });
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
