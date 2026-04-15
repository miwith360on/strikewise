import { env } from '../config/env.js';
import type { LightningProvider } from '../types/lightning.js';
import { BlitzortungProvider } from './blitzortungProvider.js';
import { MockLightningProvider } from './mockLightningProvider.js';
import { NoaaGlmProvider } from './noaaGlmProvider.js';
import { OpenMeteoProvider } from './openMeteoProvider.js';
import { TomorrowProvider } from './tomorrowProvider.js';
import { XWeatherProvider } from './xweatherProvider.js';

export function createLightningProvider(): LightningProvider {
  if (env.LIGHTNING_PROVIDER === 'tomorrow') {
    return new TomorrowProvider();
  }

  if (env.LIGHTNING_PROVIDER === 'open-meteo') {
    return new OpenMeteoProvider();
  }

  if (env.LIGHTNING_PROVIDER === 'blitzortung') {
    return new BlitzortungProvider();
  }

  if (env.LIGHTNING_PROVIDER === 'xweather') {
    return new XWeatherProvider();
  }

  if (env.LIGHTNING_PROVIDER === 'noaa-glm') {
    return new NoaaGlmProvider();
  }

  return new MockLightningProvider();
}
