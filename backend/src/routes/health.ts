import { Router } from 'express';
import { env } from '../config/env.js';

export const healthRouter = Router();

healthRouter.get('/', (_request, response) => {
  response.json({
    ok: true,
    service: 'strikewise-backend',
    provider: env.LIGHTNING_PROVIDER,
    timestamp: Date.now(),
  });
});
