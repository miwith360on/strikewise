import { Router } from 'express';
import { env } from '../config/env.js';
import { providerRegistry } from '../providers/index.js';

export const healthRouter = Router();

healthRouter.get('/', (_request, response) => {
  const providerHealth = providerRegistry.getHealth();
  const activeProvider = providerRegistry.getActiveName();
  const anyDegraded = providerHealth.some((p) => p.errorCount > 0);
  const allDegraded = providerHealth.every((p) => !p.active && p.errorCount > 0);

  const lastSuccessAt = providerHealth
    .map((p) => p.lastSuccessAt)
    .filter((t): t is number => t !== null)
    .reduce((max, t) => Math.max(max, t), 0) || null;

  const dataAgeSec = lastSuccessAt !== null
    ? Math.round((Date.now() - lastSuccessAt) / 1000)
    : null;

  response.status(allDegraded ? 503 : 200).json({
    ok: !allDegraded,
    service: 'strikewise-backend',
    configuredProvider: env.LIGHTNING_PROVIDER,
    activeProvider,
    status: allDegraded ? 'degraded' : anyDegraded ? 'partial' : 'ok',
    dataAgeSec,
    lastSuccessAt,
    providers: providerHealth,
    timestamp: Date.now(),
  });
});
