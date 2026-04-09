import { env } from '../config/env.js';
import type { LightningProvider, LightningQuery, LightningResponse } from '../types/lightning.js';

function getCurrentNoaaPrefix(date = new Date()) {
  const year = date.getUTCFullYear();
  const start = Date.UTC(year, 0, 0);
  const diff = date.getTime() - start;
  const dayOfYear = String(Math.floor(diff / 86400000)).padStart(3, '0');
  const hour = String(date.getUTCHours()).padStart(2, '0');
  return `${env.NOAA_GLM_PRODUCT}/${year}/${dayOfYear}/${hour}/`;
}

function extractKeys(xml: string) {
  const matches = [...xml.matchAll(/<Key>(.*?)<\/Key>/g)];
  return matches.map((match) => match[1]).slice(-10);
}

export class NoaaGlmProvider implements LightningProvider {
  async getRecentStrikes(_query: LightningQuery): Promise<LightningResponse> {
    const prefix = getCurrentNoaaPrefix();
    const listUrl = `${env.NOAA_GLM_BASE_URL}?list-type=2&prefix=${encodeURIComponent(prefix)}`;

    let latestObjectKeys: string[] = [];
    const notes: string[] = [];

    try {
      const response = await fetch(listUrl);
      if (!response.ok) {
        notes.push(`NOAA bucket listing failed with status ${response.status}.`);
      } else {
        const xml = await response.text();
        latestObjectKeys = extractKeys(xml);
        notes.push('NOAA GLM bucket access succeeded. NetCDF parsing is the next integration step.');
      }
    } catch (error) {
      notes.push(error instanceof Error ? error.message : 'Unknown NOAA fetch error.');
    }

    return {
      provider: 'noaa-glm',
      generatedAt: Date.now(),
      strikes: [],
      meta: {
        simulated: false,
        source: 'noaa-goes-glm',
        providerStatus: 'degraded',
        bucket: env.NOAA_GLM_BUCKET,
        product: env.NOAA_GLM_PRODUCT,
        latestObjectKeys,
        notes,
      },
    };
  }
}
