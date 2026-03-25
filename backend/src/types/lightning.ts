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

export interface LightningMeta {
  simulated: boolean;
  source: string;
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
