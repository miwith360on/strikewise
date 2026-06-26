import assert from 'node:assert/strict';
import test from 'node:test';

import express from 'express';
import request from 'supertest';
import { ZodError } from 'zod';

process.env.LIGHTNING_PROVIDER = 'mock';

type RouteModules = {
  healthRouter: express.Router;
  lightningRouter: express.Router;
  alertsRouter: express.Router;
};

let cachedRoutes: RouteModules | null = null;

async function loadRoutes(): Promise<RouteModules> {
  if (cachedRoutes) {
    return cachedRoutes;
  }

  const [{ healthRouter }, { lightningRouter }, { alertsRouter }] = await Promise.all([
    import('./health.js'),
    import('./lightning.js'),
    import('./alerts.js'),
  ]);

  cachedRoutes = { healthRouter, lightningRouter, alertsRouter };
  return cachedRoutes;
}

function createTestApp(router: express.Router, mountPath: string) {
  const app = express();
  app.use(express.json());
  app.use(mountPath, router);

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof ZodError) {
      res.status(400).json({ error: 'Invalid request', details: error.flatten() });
      return;
    }

    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(500).json({ error: message });
  });

  return app;
}

test('GET /health returns service status payload', async () => {
  const { healthRouter } = await loadRoutes();
  const app = createTestApp(healthRouter, '/health');

  const res = await request(app).get('/health');

  assert.equal(res.status, 200);
  assert.equal(res.body.service, 'strikewise-backend');
  assert.equal(typeof res.body.activeProvider, 'string');
  assert.ok(Array.isArray(res.body.providers));
});

test('GET /api/lightning validates query schema', async () => {
  const { lightningRouter } = await loadRoutes();
  const app = createTestApp(lightningRouter, '/api/lightning');

  const res = await request(app).get('/api/lightning?minutes=120');

  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'Invalid request');
});

test('GET /api/lightning returns a valid lightning response payload', async () => {
  const { lightningRouter } = await loadRoutes();
  const app = createTestApp(lightningRouter, '/api/lightning');

  const res = await request(app).get('/api/lightning?minutes=10');

  assert.equal(res.status, 200);
  assert.equal(typeof res.body.provider, 'string');
  assert.ok(Array.isArray(res.body.strikes));
  assert.equal(typeof res.body.generatedAt, 'number');
  assert.equal(typeof res.body.meta, 'object');
});

test('GET /api/alerts validates required location params', async () => {
  const { alertsRouter } = await loadRoutes();
  const app = createTestApp(alertsRouter, '/api/alerts');

  const res = await request(app).get('/api/alerts');

  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'lat and lng query params are required');
});

test('GET /api/alerts returns outside-us payload when upstream is 404', async () => {
  const { alertsRouter } = await loadRoutes();
  const app = createTestApp(alertsRouter, '/api/alerts');

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('', { status: 404 })) as typeof fetch;

  try {
    const res = await request(app).get('/api/alerts?lat=48.5&lng=2.2');

    assert.equal(res.status, 200);
    assert.equal(res.body.active, false);
    assert.equal(res.body.region, 'outside-us');
    assert.ok(Array.isArray(res.body.alerts));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GET /api/alerts filters to relevant severe events', async () => {
  const { alertsRouter } = await loadRoutes();
  const app = createTestApp(alertsRouter, '/api/alerts');

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    const payload = {
      features: [
        {
          id: 'a1',
          properties: {
            event: 'Severe Thunderstorm Warning',
            severity: 'Severe',
            urgency: 'Immediate',
            headline: 'Severe thunderstorm warning in your area',
            senderName: 'NWS Test',
          },
        },
        {
          id: 'a2',
          properties: {
            event: 'Heat Advisory',
            severity: 'Moderate',
            urgency: 'Expected',
            headline: 'Hot weather expected',
            senderName: 'NWS Test',
          },
        },
      ],
    };

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/geo+json' },
    });
  }) as typeof fetch;

  try {
    const res = await request(app).get('/api/alerts?lat=32.8&lng=-96.8');

    assert.equal(res.status, 200);
    assert.equal(res.body.active, true);
    assert.equal(res.body.maxSeverity, 'Severe');
    assert.equal(res.body.alerts.length, 1);
    assert.equal(res.body.alerts[0].event, 'Severe Thunderstorm Warning');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
