import { Router } from 'express';
import { z } from 'zod';
import { enrichLightningResponse } from '../lib/lightningAnalysis.js';
import { createLightningProvider } from '../providers/index.js';
import type { BoundingBox, LightningQuery, LightningResponse } from '../types/lightning.js';

const CACHE_TTL_MS = 10_000;
const provider = createLightningProvider();
const responseCache = new Map<string, { cachedAt: number; payload: LightningResponse }>();

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

lightningRouter.get('/', async (request, response, next) => {
  try {
    const query = querySchema.parse(request.query);
    const normalizedQuery = {
      bounds: buildBounds(query),
      minutes: query.minutes,
    };
    const cacheKey = toQueryKey(normalizedQuery);
    const cachedEntry = responseCache.get(cacheKey);
    const isCacheHit = cachedEntry !== undefined && Date.now() - cachedEntry.cachedAt < CACHE_TTL_MS;
    const payload = isCacheHit
      ? cachedEntry.payload
      : await provider.getRecentStrikes(normalizedQuery);

    if (!isCacheHit) {
      responseCache.set(cacheKey, {
        cachedAt: Date.now(),
        payload,
      });
    }

    const analyzedPayload = enrichLightningResponse(
      normalizedQuery,
      payload,
      isCacheHit && cachedEntry
        ? {
            cached: true,
            cacheAgeSeconds: Math.max(0, Math.round((Date.now() - cachedEntry.cachedAt) / 1000)),
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
