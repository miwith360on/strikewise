import { Router } from 'express';
import { z } from 'zod';
import { createLightningProvider } from '../providers/index.js';
import type { BoundingBox } from '../types/lightning.js';

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

lightningRouter.get('/', async (request, response, next) => {
  try {
    const query = querySchema.parse(request.query);
    const provider = createLightningProvider();
    const payload = await provider.getRecentStrikes({
      bounds: buildBounds(query),
      minutes: query.minutes,
    });

    response.json(payload);
  } catch (error) {
    next(error);
  }
});
