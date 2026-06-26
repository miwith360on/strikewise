import { useCallback, useEffect, useState } from 'react';
import type {
  AlertConfig,
  FeedStatus,
  LightningFeedMeta,
  LightningStrike,
  MonitoredLocation,
  SafetyStatus,
  ThunderETAEntry,
} from '@/services/lightning/types';
import {
  ALL_CLEAR_WINDOW_MS,
  DEFAULT_LOCATION,
  lightningService,
  lightningServiceMode,
} from '@/services/lightning/lightningService';
import { haversineKm } from '@/services/lightning/geo';
import type { MapBounds } from '@/services/lightning/types';

const QUERY_WINDOW_MINUTES = 30;
const QUERY_LAT_SPAN = 0.8;
const QUERY_LNG_SPAN = 1.1;

const DEFAULT_CONFIG: AlertConfig = {
  dangerRadiusKm: 8,
  warningRadiusKm: 16,
  cautionRadiusKm: 25,
  soundEnabled: true,
  vibrationEnabled: true,
  repeatIntervalSec: 60,
  monitored: DEFAULT_LOCATION,
};

export interface LightningFeedState {
  strikes: LightningStrike[];
  safetyStatus: SafetyStatus;
  thunderETAs: ThunderETAEntry[];
  alertConfig: AlertConfig;
  newestStrikeId: string | null;
  isLive: boolean;
  feedStatus: FeedStatus;
  feedMessage: string;
  feedMeta: LightningFeedMeta | null;
  setAlertConfig: (cfg: AlertConfig) => void;
  setMonitoredLocation: (location: MonitoredLocation) => void;
}

/** Returns the haversine distance from the monitored location to a strike */
export function strikeDistanceKm(strike: LightningStrike, config: AlertConfig): number {
  return haversineKm(
    config.monitored.lat,
    config.monitored.lng,
    strike.lat,
    strike.lng,
  );
}

function getBoundsForLocation(location: MonitoredLocation): MapBounds {
  return {
    northEast: { lat: location.lat + QUERY_LAT_SPAN, lng: location.lng + QUERY_LNG_SPAN },
    southWest: { lat: location.lat - QUERY_LAT_SPAN, lng: location.lng - QUERY_LNG_SPAN },
  };
}

function formatProviderLabel(meta: LightningFeedMeta | null): string | null {
  if (!meta?.provider) return null;
  return meta.provider.charAt(0).toUpperCase() + meta.provider.slice(1);
}

function buildFeedMessage(meta: LightningFeedMeta | null, queryWindowMinutes: number): string {
  const providerLabel = formatProviderLabel(meta);
  const prefix = providerLabel ? `${providerLabel} · ` : '';

  if (!meta) {
    return 'Live lightning feed';
  }

  if (meta.resultState === 'stale' && meta.freshnessSeconds !== null && meta.freshnessSeconds !== undefined) {
    return `${prefix}Feed delayed by ${Math.ceil(meta.freshnessSeconds / 60)} min`;
  }

  if (meta.resultState === 'empty') {
    if (meta.simulated) {
      return `${prefix}No nearby modeled lightning in the last ${queryWindowMinutes} min`;
    }
    if (meta.providerStatus === 'degraded') {
      return `${prefix}Limited live coverage right now; no nearby strikes in ${queryWindowMinutes} min`;
    }
    return `${prefix}No nearby strikes in the last ${queryWindowMinutes} min`;
  }

  if (meta.cached) {
    return `${prefix}cached ${meta.cacheAgeSeconds ?? 0}s ago`;
  }

  if (meta.simulated) {
    return `${prefix}Modeled lightning estimate`;
  }

  if (meta.providerStatus === 'degraded') {
    return `${prefix}Live feed in degraded mode`;
  }

  return `${prefix}Live feed`;
}

export function useLightningFeed(): LightningFeedState {
  const [strikes, setStrikes] = useState<LightningStrike[]>([]);
  const [alertConfig, setAlertConfigState] = useState<AlertConfig>(DEFAULT_CONFIG);
  const [newestStrikeId, setNewestStrikeId] = useState<string | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [feedMeta, setFeedMeta] = useState<LightningFeedMeta | null>(null);
  const [feedStatus, setFeedStatus] = useState<FeedStatus>(
    lightningServiceMode === 'demo' ? 'demo' : 'connecting',
  );
  const [feedMessage, setFeedMessage] = useState(
    lightningServiceMode === 'demo'
      ? 'Demo feed only'
      : 'Connecting to live lightning feed',
  );
  const monitored = alertConfig.monitored;

  // Connect once so the service can choose HTTP or mock mode before subscribing.
  useEffect(() => {
    let cancelled = false;
    let unsub = () => {};
    const bounds = getBoundsForLocation(monitored);

    setNewestStrikeId(null);
    setIsLive(lightningServiceMode === 'demo');
    setFeedMeta(lightningService.getLatestMeta());
    setFeedStatus(lightningServiceMode === 'demo' ? 'demo' : 'connecting');
    setFeedMessage(
      lightningServiceMode === 'demo'
        ? 'Demo feed only'
        : 'Connecting to live lightning feed',
    );

    void lightningService.getRecentStrikes(bounds, QUERY_WINDOW_MINUTES)
      .then((initial) => {
        if (cancelled) {
          return;
        }

        setStrikes(initial);
        const latestMeta = lightningService.getLatestMeta();
        setFeedMeta(latestMeta);
        if (lightningServiceMode === 'live') {
          setIsLive(true);
          setFeedStatus('live');
          setFeedMessage(buildFeedMessage(latestMeta, QUERY_WINDOW_MINUTES));
        }

        unsub = lightningService.subscribeToLiveStrikes(bounds, QUERY_WINDOW_MINUTES, (strike) => {
          const currentMeta = lightningService.getLatestMeta();
          setFeedMeta(currentMeta);
          if (lightningServiceMode === 'live') {
            setIsLive(true);
            setFeedStatus('live');
            setFeedMessage(buildFeedMessage(currentMeta, QUERY_WINDOW_MINUTES));
          }

          setStrikes((prev) => {
            if (prev.some((existing) => existing.id === strike.id)) {
              return prev;
            }

            const cutoff = Date.now() - ALL_CLEAR_WINDOW_MS;
            const pruned = prev.filter((s) => s.timestamp > cutoff);
            return [...pruned, strike];
          });
          setNewestStrikeId(strike.id);
        });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setStrikes([]);
          setNewestStrikeId(null);
          setIsLive(false);
          setFeedMeta(null);
          if (lightningServiceMode === 'demo') {
            setFeedStatus('demo');
            setFeedMessage('Demo feed only');
          } else {
            setFeedStatus('unavailable');
            setFeedMessage(
              error instanceof Error ? error.message : 'Live lightning feed unavailable',
            );
          }
        }
      });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [monitored]);

  const setAlertConfig = useCallback((cfg: AlertConfig) => {
    setAlertConfigState(cfg);
  }, []);

  const setMonitoredLocation = useCallback((location: MonitoredLocation) => {
    setAlertConfigState((prev) => ({
      ...prev,
      monitored: location,
    }));
  }, []);

  const location = { lat: alertConfig.monitored.lat, lng: alertConfig.monitored.lng };
  const safetyStatus = lightningService.getSafetyStatus(location, strikes, alertConfig, feedMeta);
  const thunderETAs = lightningService.getThunderETAs(location, strikes);

  return {
    strikes,
    safetyStatus,
    thunderETAs,
    alertConfig,
    newestStrikeId,
    isLive,
    feedStatus,
    feedMessage,
    feedMeta,
    setAlertConfig,
    setMonitoredLocation,
  };
}
