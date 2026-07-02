export interface BlitzortungFeedStrike {
  id: string;
  provider: 'blitzortung';
  timestamp: number;
  lat: number;
  lon: number;
  distanceKm: number;
  polarity: number | null;
  peakCurrentKa: number | null;
  type: string;
  stationCount: number | null;
}

export interface BlitzortungFeedHealth {
  provider: 'blitzortung';
  state: 'LIVE' | 'DEGRADED' | 'DOWN';
  connected: boolean;
  lastMessageAgeMs: number | null;
  lastStrikeAgeMs: number | null;
  bufferedStrikes: number;
  totalReceived: number;
  totalKept: number;
  uptimeMs: number;
  qualityHint: 'high' | 'unknown' | 'none';
}

export interface BlitzortungProviderOptions {
  lat: number;
  lon: number;
  radiusKm?: number;
  windowMs?: number;
  onStrike?: (strike: BlitzortungFeedStrike) => void;
}

export class BlitzortungProvider {
  constructor(opts: BlitzortungProviderOptions);
  start(): void;
  stop(): void;
  setMonitoredPoint(lat: number, lon: number): void;
  getStrikes(): BlitzortungFeedStrike[];
  getHealth(): BlitzortungFeedHealth;
}

export function decodeBlitzortung(data: string): string;
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number;
