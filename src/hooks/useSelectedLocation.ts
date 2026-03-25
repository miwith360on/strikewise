import { useEffect, useState } from 'react';
import type { MonitoredLocation } from '@/services/lightning/types';
import { DEFAULT_LOCATION } from '@/services/lightning/lightningService';

export interface UseLocationResult {
  location: MonitoredLocation;
  gpsLoading: boolean;
  gpsError: string | null;
  requestGPS: () => void;
  setManualLocation: (lat: number, lng: number, label?: string) => void;
}

export function useSelectedLocation(): UseLocationResult {
  const [location, setLocation] = useState<MonitoredLocation>(DEFAULT_LOCATION);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);

  const setManualLocation = (lat: number, lng: number, label = 'Pinned Location') => {
    setGpsError(null);
    setLocation({
      id: `loc-manual-${Math.round(lat * 1000)}-${Math.round(lng * 1000)}`,
      label,
      lat,
      lng,
    });
  };

  const requestGPS = () => {
    if (!navigator.geolocation) {
      setGpsError('Geolocation not supported by this browser');
      return;
    }
    setGpsLoading(true);
    setGpsError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation({
          id: 'loc-gps',
          label: 'Current Location',
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
        setGpsLoading(false);
      },
      (err) => {
        setGpsError(err.message);
        setGpsLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  // Attempt GPS on mount (non-blocking — falls back to default)
  useEffect(() => {
    requestGPS();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { location, gpsLoading, gpsError, requestGPS, setManualLocation };
}
