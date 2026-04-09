export interface LatLng {
  lat: number;
  lng: number;
}

export interface LightningStrike {
  id: string;
  lat: number;
  lng: number;
  timestamp: number;
  intensityKa: number;
  polarity: 'negative' | 'positive';
  multiplicity: number;
}

export interface BoundingBox {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface LightningQuery {
  bounds?: BoundingBox;
  minutes: number;
}

export type LightningProviderStatus = 'ok' | 'degraded';
export type LightningResultState = 'active' | 'empty' | 'stale';
export type LightningTrend = 'approaching' | 'departing' | 'steady' | 'unknown';

export interface LightningMeta {
  simulated: boolean;
  source: string;
  providerStatus?: LightningProviderStatus;
  resultState?: LightningResultState;
  cached?: boolean;
  cacheAgeSeconds?: number;
  freshnessSeconds?: number | null;
  latestStrikeAgeSeconds?: number | null;
  trend?: LightningTrend;
  allClearMinutesRemaining?: number;
  closestStrikeKm?: number | null;
  strikeCountLast10min?: number;
  dataQualityScore?: number;
  queryMinutes?: number;
  analysisRadiusKm?: number | null;
  normalizedStrikeCount?: number;
  filteredStrikeCount?: number;
  notes?: string[];
  latestObjectKeys?: string[];
  product?: string;
  bucket?: string;
}

export interface LightningResponse {
  provider: string;
  generatedAt: number;
  strikes: LightningStrike[];
  meta: LightningMeta;
}

export interface LightningProvider {
  getRecentStrikes(query: LightningQuery): Promise<LightningResponse>;
}
