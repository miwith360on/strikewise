import { env } from '../config/env.js';
import { ProviderRegistry } from '../lib/providerRegistry.js';
import type { LightningProvider } from '../types/lightning.js';
import { BlitzortungProvider } from './blitzortungProvider.js';
import { MockLightningProvider } from './mockLightningProvider.js';
import { NoaaGlmProvider } from './noaaGlmProvider.js';
import { OpenMeteoProvider } from './openMeteoProvider.js';
import { TomorrowProvider } from './tomorrowProvider.js';
import { XWeatherProvider } from './xweatherProvider.js';

function buildProviderChain(): { name: string; provider: LightningProvider }[] {
  if (env.LIGHTNING_PROVIDER === 'auto') {
    const chain: { name: string; provider: LightningProvider }[] = [];

    // Best observed feed first if credentials exist
    if (env.XWEATHER_CLIENT_ID && env.XWEATHER_CLIENT_SECRET) {
      chain.push({ name: 'xweather', provider: new XWeatherProvider() });
    }

    // Real-time community feed
    chain.push({ name: 'blitzortung', provider: new BlitzortungProvider() });

    // Modelled fallback (no API key required)
    chain.push({ name: 'open-meteo', provider: new OpenMeteoProvider() });

    return chain;
  }

  if (env.LIGHTNING_PROVIDER === 'tomorrow') {
    return [
      { name: 'tomorrow', provider: new TomorrowProvider() },
      { name: 'open-meteo', provider: new OpenMeteoProvider() },
    ];
  }

  if (env.LIGHTNING_PROVIDER === 'xweather') {
    return [
      { name: 'xweather', provider: new XWeatherProvider() },
      { name: 'blitzortung', provider: new BlitzortungProvider() },
    ];
  }

  if (env.LIGHTNING_PROVIDER === 'blitzortung') {
    return [
      { name: 'blitzortung', provider: new BlitzortungProvider() },
      { name: 'open-meteo', provider: new OpenMeteoProvider() },
    ];
  }

  if (env.LIGHTNING_PROVIDER === 'open-meteo') {
    return [{ name: 'open-meteo', provider: new OpenMeteoProvider() }];
  }

  if (env.LIGHTNING_PROVIDER === 'noaa-glm') {
    return [{ name: 'noaa-glm', provider: new NoaaGlmProvider() }];
  }

  // mock / default
  return [{ name: 'mock', provider: new MockLightningProvider() }];
}

// Singleton registry shared across routes
export const providerRegistry = new ProviderRegistry(buildProviderChain());

/** Backwards-compatible shim used by lightning route */
export function createLightningProvider(): LightningProvider {
  return providerRegistry;
}
