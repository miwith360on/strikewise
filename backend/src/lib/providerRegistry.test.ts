import assert from 'node:assert/strict';
import test from 'node:test';

import { ProviderRegistry } from './providerRegistry.js';
import type {
  LightningProvider,
  LightningQuery,
  LightningResponse,
  LightningStrike,
} from '../types/lightning.js';

const QUERY: LightningQuery = { minutes: 30 };

function makeStrike(id: string): LightningStrike {
  return {
    id,
    lat: 32.8,
    lng: -96.8,
    timestamp: Date.now(),
    intensityKa: 20,
    polarity: 'negative',
    multiplicity: 1,
  };
}

function makeResponse(
  provider: string,
  options?: { degraded?: boolean; strikes?: LightningStrike[] },
): LightningResponse {
  const strikes = options?.strikes ?? [];
  return {
    provider,
    generatedAt: Date.now(),
    strikes,
    meta: {
      simulated: false,
      source: `${provider}-test`,
      providerStatus: options?.degraded ? 'degraded' : 'ok',
      notes: [],
    },
  };
}

class StaticProvider implements LightningProvider {
  constructor(private readonly payload: LightningResponse) {}

  async getRecentStrikes(_query: LightningQuery): Promise<LightningResponse> {
    return this.payload;
  }
}

class ThrowingProvider implements LightningProvider {
  constructor(private readonly message: string) {}

  async getRecentStrikes(_query: LightningQuery): Promise<LightningResponse> {
    throw new Error(this.message);
  }
}

test('falls back when primary throws and promotes secondary to active', async () => {
  const registry = new ProviderRegistry([
    { name: 'primary', provider: new ThrowingProvider('primary down') },
    { name: 'secondary', provider: new StaticProvider(makeResponse('secondary', { strikes: [makeStrike('s1')] })) },
  ]);

  const result = await registry.getRecentStrikes(QUERY);
  assert.equal(result.provider, 'secondary');
  assert.ok(result.meta.notes?.some((n) => n.includes('Failover: using secondary')));
  assert.equal(registry.getActiveName(), 'secondary');

  const health = registry.getHealth();
  assert.equal(health[0].errorCount, 1);
  assert.equal(health[0].active, false);
  assert.equal(health[1].active, true);
});

test('falls back when primary is degraded and empty', async () => {
  const registry = new ProviderRegistry([
    {
      name: 'primary',
      provider: new StaticProvider(makeResponse('primary', { degraded: true, strikes: [] })),
    },
    {
      name: 'secondary',
      provider: new StaticProvider(makeResponse('secondary', { strikes: [makeStrike('s2')] })),
    },
  ]);

  const result = await registry.getRecentStrikes(QUERY);
  assert.equal(result.provider, 'secondary');
  assert.ok(result.meta.notes?.some((n) => n.includes('Failover: using secondary')));

  const health = registry.getHealth();
  assert.equal(health[0].errorCount, 1);
  assert.equal(
    health[0].lastError,
    'Provider reported degraded status with empty strike payload',
  );
  assert.equal(health[1].active, true);
});

test('does not fail over when primary is degraded but has strikes', async () => {
  const registry = new ProviderRegistry([
    {
      name: 'primary',
      provider: new StaticProvider(
        makeResponse('primary', { degraded: true, strikes: [makeStrike('p1')] }),
      ),
    },
    {
      name: 'secondary',
      provider: new StaticProvider(makeResponse('secondary', { strikes: [makeStrike('s3')] })),
    },
  ]);

  const result = await registry.getRecentStrikes(QUERY);
  assert.equal(result.provider, 'primary');
  assert.ok(!result.meta.notes?.some((n) => n.includes('Failover: using')));
  assert.equal(registry.getActiveName(), 'primary');

  const health = registry.getHealth();
  assert.equal(health[0].errorCount, 0);
  assert.equal(health[0].active, true);
  assert.equal(health[1].totalRequests, 0);
});

test('returns degraded error payload when all providers fail', async () => {
  const registry = new ProviderRegistry([
    { name: 'primary', provider: new ThrowingProvider('primary down') },
    { name: 'secondary', provider: new ThrowingProvider('secondary down') },
  ]);

  const result = await registry.getRecentStrikes(QUERY);
  assert.equal(result.provider, 'error');
  assert.equal(result.meta.providerStatus, 'degraded');
  assert.ok(
    result.meta.notes?.[0]?.includes('All providers failed (primary, secondary)'),
  );

  const health = registry.getHealth();
  assert.equal(health[0].errorCount, 1);
  assert.equal(health[1].errorCount, 1);
});
