import { useCallback, useEffect, useState } from 'react';
import type { MonitoredLocation } from '@/services/lightning/types';
import { DEFAULT_LOCATION } from '@/services/lightning/lightningService';

const LAST_LOCATION_STORAGE_KEY = 'strikewise:last-location';

function loadPersistedLocation(): MonitoredLocation | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(LAST_LOCATION_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as MonitoredLocation;
    if (
      typeof parsed?.id === 'string' &&
      typeof parsed?.label === 'string' &&
      Number.isFinite(parsed?.lat) &&
      Number.isFinite(parsed?.lng)
    ) {
      return parsed;
    }
  } catch {
    // Ignore malformed local storage and fall back to default.
  }

  return null;
}

function persistLocation(location: MonitoredLocation) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(LAST_LOCATION_STORAGE_KEY, JSON.stringify(location));
  } catch {
    // Ignore storage write failures.
  }
}

export interface UseLocationResult {
  location: MonitoredLocation;
  gpsLoading: boolean;
  gpsError: string | null;
  requestGPS: () => void;
  setManualLocation: (lat: number, lng: number, label?: string) => void;
}

export function useSelectedLocation(): UseLocationResult {
  const [location, setLocation] = useState<MonitoredLocation>(() => loadPersistedLocation() ?? DEFAULT_LOCATION);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);

  const setManualLocation = (lat: number, lng: number, label = 'Pinned Location') => {
    setGpsError(null);
    const nextLocation: MonitoredLocation = {
      id: `loc-manual-${Math.round(lat * 1000)}-${Math.round(lng * 1000)}`,
      label,
      lat,
      lng,
    };
    setLocation(nextLocation);
    persistLocation(nextLocation);
  };

  const requestGPS = useCallback(() => {
    if (!navigator.geolocation) {
      setGpsError('Geolocation not supported by this browser');
      return;
    }
    setGpsLoading(true);
    setGpsError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const nextLocation: MonitoredLocation = {
          id: 'loc-gps',
          label: 'Current Location',
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };
        setLocation(nextLocation);
        persistLocation(nextLocation);
        setGpsLoading(false);
      },
      (err) => {
        setGpsError(err.message);
        setGpsLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, []);

  // Attempt GPS on mount (non-blocking — falls back to default)
  useEffect(() => {
    requestGPS();
  }, [requestGPS]);

  return { location, gpsLoading, gpsError, requestGPS, setManualLocation };
}
