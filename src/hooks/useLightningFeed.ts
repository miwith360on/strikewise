import { useCallback, useEffect, useState } from 'react';
import type {
  AlertConfig,
  LightningStrike,
  MonitoredLocation,
  SafetyStatus,
  ThunderETAEntry,
} from '@/services/lightning/types';
import { lightningService } from '@/services/lightning/lightningService';
import { DEFAULT_LOCATION } from '@/services/lightning/lightningService';
import { haversineKm } from '@/services/lightning/mockData';

const DEFAULT_BOUNDS = {
  northEast: { lat: DEFAULT_LOCATION.lat + 0.8, lng: DEFAULT_LOCATION.lng + 1.1 },
  southWest: { lat: DEFAULT_LOCATION.lat - 0.8, lng: DEFAULT_LOCATION.lng - 1.1 },
};

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

export function useLightningFeed(): LightningFeedState {
  const [strikes, setStrikes] = useState<LightningStrike[]>([]);
  const [alertConfig, setAlertConfigState] = useState<AlertConfig>(DEFAULT_CONFIG);
  const [newestStrikeId, setNewestStrikeId] = useState<string | null>(null);
  const [isLive, setIsLive] = useState(false);

  // Load initial seed strikes
  useEffect(() => {
    lightningService
      .getRecentStrikes(DEFAULT_BOUNDS, 10)
      .then((initial) => setStrikes(initial));
  }, []);

  // Subscribe to live strike feed
  useEffect(() => {
    const unsub = lightningService.subscribeToLiveStrikes(DEFAULT_BOUNDS, (strike) => {
      setIsLive(true);
      setStrikes((prev) => {
        if (prev.some((existing) => existing.id === strike.id)) {
          return prev;
        }

        const cutoff = Date.now() - 10 * 60 * 1000;
        const pruned = prev.filter((s) => s.timestamp > cutoff);
        return [...pruned, strike];
      });
      setNewestStrikeId(strike.id);
    });
    return unsub;
  }, []);

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
  const safetyStatus = lightningService.getSafetyStatus(location, strikes, alertConfig);
  const thunderETAs = lightningService.getThunderETAs(location, strikes);

  return {
    strikes,
    safetyStatus,
    thunderETAs,
    alertConfig,
    newestStrikeId,
    isLive,
    setAlertConfig,
    setMonitoredLocation,
  };
}
