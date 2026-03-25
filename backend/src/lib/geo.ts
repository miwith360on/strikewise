import type { BoundingBox } from '../types/lightning.js';

export function isPointInBounds(lat: number, lng: number, bounds: BoundingBox) {
  return (
    lat <= bounds.north &&
    lat >= bounds.south &&
    lng <= bounds.east &&
    lng >= bounds.west
  );
}

export function getBoundsCenter(bounds: BoundingBox) {
  return {
    lat: (bounds.north + bounds.south) / 2,
    lng: (bounds.east + bounds.west) / 2,
  };
}
