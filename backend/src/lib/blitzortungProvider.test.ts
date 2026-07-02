import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { BlitzortungProvider } = require('./blitzortungProvider.cjs') as {
  BlitzortungProvider: new (opts?: { lat?: number; lon?: number }) => any;
};

test('start is idempotent and does not double-connect', () => {
  const provider = new BlitzortungProvider({ lat: 32.7, lon: -96.8 });

  let connectCalls = 0;
  provider._connect = () => {
    connectCalls += 1;
  };

  provider.start();
  provider.start();

  assert.equal(connectCalls, 1);
  provider.stop();
});

test('setMonitoredPoint ignores invalid coordinates', () => {
  const provider = new BlitzortungProvider({ lat: 32.7, lon: -96.8 });

  provider.setMonitoredPoint(Number.NaN, -96.7);
  assert.deepEqual(provider.monitored, { lat: 32.7, lon: -96.8 });

  provider.setMonitoredPoint(91, -96.7);
  assert.deepEqual(provider.monitored, { lat: 32.7, lon: -96.8 });

  provider.setMonitoredPoint(32.8, -96.7);
  assert.deepEqual(provider.monitored, { lat: 32.8, lon: -96.7 });
});

test('handleStrike rejects malformed payloads', () => {
  const provider = new BlitzortungProvider({ lat: 32.7, lon: -96.8 });

  provider._handleStrike(null);
  provider._handleStrike({ lat: 32.8, lon: -96.7, time: Number.NaN });
  provider._handleStrike({ lat: 32.8, lon: -96.7 });

  assert.equal(provider.buffer.length, 0);
  assert.equal(provider.totalKept, 0);

  provider._handleStrike({
    lat: 32.8,
    lon: -96.7,
    time: Date.now() * 1e6,
    pol: 1,
    sig: [],
  });

  assert.equal(provider.buffer.length, 1);
  assert.equal(provider.totalKept, 1);
});
