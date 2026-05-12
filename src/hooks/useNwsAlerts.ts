import { useEffect, useRef, useState } from 'react';
import type { MonitoredLocation } from '@/services/lightning/types';

const POLL_INTERVAL_MS = 2 * 60 * 1000;   // Check every 2 minutes
const BASE_URL = import.meta.env.VITE_API_URL ?? '';

export interface NwsAlert {
  id: string;
  event: string;
  severity: string;
  urgency: string;
  headline: string;
  expires: string | null;
  effective: string | null;
  senderName: string;
}

export interface NwsAlertsState {
  active: boolean;
  maxSeverity: string | null;
  alerts: NwsAlert[];
  loading: boolean;
  outsideUs: boolean;
}

export function useNwsAlerts(location: MonitoredLocation): NwsAlertsState {
  const [state, setState] = useState<NwsAlertsState>({
    active: false,
    maxSeverity: null,
    alerts: [],
    loading: false,
    outsideUs: false,
  });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    setState((prev) => ({ ...prev, loading: true }));

    const fetch_ = async () => {
      try {
        const res = await fetch(
          `${BASE_URL}/api/alerts?lat=${location.lat}&lng=${location.lng}`,
        );
        if (!res.ok) throw new Error(`NWS proxy ${res.status}`);
        const data = await res.json() as {
          active: boolean;
          maxSeverity: string | null;
          alerts: NwsAlert[];
          region?: string;
        };
        if (cancelledRef.current) return;
        setState({
          active: data.active,
          maxSeverity: data.maxSeverity,
          alerts: data.alerts,
          loading: false,
          outsideUs: data.region === 'outside-us',
        });
      } catch {
        if (!cancelledRef.current) {
          setState((prev) => ({ ...prev, loading: false }));
        }
      }

      if (!cancelledRef.current) {
        timerRef.current = setTimeout(fetch_, POLL_INTERVAL_MS);
      }
    };

    void fetch_();

    return () => {
      cancelledRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [location.lat, location.lng]);

  return state;
}
