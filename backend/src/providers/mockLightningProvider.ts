import type { LightningProvider, LightningQuery, LightningResponse, LightningStrike } from '../types/lightning.js';
import { getBoundsCenter, isPointInBounds } from '../lib/geo.js';

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeStrike(center: { lat: number; lng: number }, random: () => number, index: number): LightningStrike {
  const latOffset = (random() - 0.5) * 0.9;
  const lngOffset = (random() - 0.5) * 0.9;

  return {
    id: `mock-${Date.now()}-${index}`,
    lat: center.lat + latOffset,
    lng: center.lng + lngOffset,
    timestamp: Date.now() - Math.floor(random() * 10 * 60 * 1000),
    intensityKa: Math.round(8 + random() * 110),
    polarity: random() > 0.2 ? 'negative' : 'positive',
    multiplicity: 1 + Math.floor(random() * 4),
  };
}

export class MockLightningProvider implements LightningProvider {
  async getRecentStrikes(query: LightningQuery): Promise<LightningResponse> {
    const random = mulberry32(Date.now());
    const center = query.bounds
      ? getBoundsCenter(query.bounds)
      : { lat: 32.7767, lng: -96.797 };

    const strikes = Array.from({ length: 28 }, (_, index) => makeStrike(center, random, index)).filter((strike) =>
      query.bounds ? isPointInBounds(strike.lat, strike.lng, query.bounds) : true,
    );

    return {
      provider: 'mock',
      generatedAt: Date.now(),
      strikes,
      meta: {
        simulated: true,
        source: 'mock-generator',
        notes: ['Backend mock provider. Safe for frontend integration before NOAA parsing is enabled.'],
      },
    };
  }
}
