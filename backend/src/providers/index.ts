import { env } from '../config/env.js';
import type { LightningProvider } from '../types/lightning.js';
import { MockLightningProvider } from './mockLightningProvider.js';
import { NoaaGlmProvider } from './noaaGlmProvider.js';
import { XWeatherProvider } from './xweatherProvider.js';

export function createLightningProvider(): LightningProvider {
  if (env.LIGHTNING_PROVIDER === 'xweather') {
    return new XWeatherProvider();
  }

  if (env.LIGHTNING_PROVIDER === 'noaa-glm') {
    return new NoaaGlmProvider();
  }

  return new MockLightningProvider();
}
