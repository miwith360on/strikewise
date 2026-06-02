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

type NwsAlertsPayload = {
  active: boolean;
  maxSeverity: string | null;
  alerts: NwsAlert[];
  region?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNwsAlert(value: unknown): value is NwsAlert {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string'
    && typeof value.event === 'string'
    && typeof value.severity === 'string'
    && typeof value.urgency === 'string'
    && typeof value.headline === 'string'
    && (value.expires === null || typeof value.expires === 'string')
    && (value.effective === null || typeof value.effective === 'string')
    && typeof value.senderName === 'string'
  );
}

function parseNwsAlertsPayload(raw: unknown): NwsAlertsPayload {
  if (!isRecord(raw)) {
    throw new Error('Invalid alerts payload: expected an object');
  }

  if (typeof raw.active !== 'boolean') {
    throw new Error('Invalid alerts payload: active must be boolean');
  }

  if (raw.maxSeverity !== null && typeof raw.maxSeverity !== 'string') {
    throw new Error('Invalid alerts payload: maxSeverity must be string or null');
  }

  if (!Array.isArray(raw.alerts) || !raw.alerts.every((alert) => isNwsAlert(alert))) {
    throw new Error('Invalid alerts payload: malformed alerts array');
  }

  if (raw.region !== undefined && typeof raw.region !== 'string') {
    throw new Error('Invalid alerts payload: region must be a string when present');
  }

  return {
    active: raw.active,
    maxSeverity: raw.maxSeverity,
    alerts: raw.alerts,
    region: raw.region,
  };
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
        const raw = await res.json();
        const data = parseNwsAlertsPayload(raw);
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
          setState({
            active: false,
            maxSeverity: null,
            alerts: [],
            loading: false,
            outsideUs: false,
          });
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
