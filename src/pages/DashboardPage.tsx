import { useEffect, useMemo, useState } from 'react';
import { useLightningFeed } from '@/hooks/useLightningFeed';
import { useSelectedLocation } from '@/hooks/useSelectedLocation';
import { useNwsAlerts } from '@/hooks/useNwsAlerts';
import { LightningMap } from '@/components/map/LightningMap';
import { MapStrikeInspector } from '@/components/map/MapStrikeInspector';
import { ThunderETAPanel } from '@/components/panels/ThunderETAPanel';
import { SafetyRadiusPanel } from '@/components/panels/SafetyRadiusPanel';
import { AlertConfigPanel } from '@/components/panels/AlertConfigPanel';
import { StrikeStatsPanel } from '@/components/panels/StrikeStatsPanel';
import { Header } from '@/components/layout/Header';
import { BellIcon, ChevronDownIcon } from '@/components/ui/Icons';
import type { LightningStrike, SafetyStatus } from '@/services/lightning/types';
import type { NwsAlert } from '@/hooks/useNwsAlerts';

function formatCoordinate(value: number, positiveLabel: string, negativeLabel: string) {
  const abs = Math.abs(value).toFixed(4);
  return `${abs}°${value >= 0 ? positiveLabel : negativeLabel}`;
}

function formatProviderName(provider?: string) {
  if (!provider || provider.length === 0) {
    return 'unknown';
  }
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

const SAFETY_LEVEL_RANK: Record<SafetyStatus['level'], number> = {
  safe: 0,
  caution: 1,
  warning: 2,
  danger: 3,
};

function levelColor(level: SafetyStatus['level']) {
  if (level === 'danger') return '#ff3333';
  if (level === 'warning') return '#ff8800';
  if (level === 'caution') return '#ffe033';
  return '#00e676';
}

function minimumLevelFromNwsAlerts(alerts: NwsAlert[]): SafetyStatus['level'] {
  let minimumLevel: SafetyStatus['level'] = 'safe';

  for (const alert of alerts) {
    const event = alert.event.toLowerCase();
    const severity = alert.severity.toLowerCase();

    if (event.includes('tornado warning')) {
      return 'danger';
    }

    if (event.includes('severe thunderstorm warning') || event.includes('flash flood warning')) {
      minimumLevel = SAFETY_LEVEL_RANK.warning > SAFETY_LEVEL_RANK[minimumLevel] ? 'warning' : minimumLevel;
      continue;
    }

    if (
      event.includes('severe thunderstorm watch') ||
      event.includes('tornado watch') ||
      severity === 'extreme' ||
      severity === 'severe'
    ) {
      minimumLevel = SAFETY_LEVEL_RANK.caution > SAFETY_LEVEL_RANK[minimumLevel] ? 'caution' : minimumLevel;
    }
  }

  return minimumLevel;
}

function applyRegionalOverride(status: SafetyStatus, alerts: NwsAlert[]): SafetyStatus {
  const minLevel = minimumLevelFromNwsAlerts(alerts);
  if (SAFETY_LEVEL_RANK[minLevel] <= SAFETY_LEVEL_RANK[status.level]) {
    return status;
  }

  const recommendation = minLevel === 'danger'
    ? 'Tornado warning in the region. Move to sturdy shelter immediately.'
    : minLevel === 'warning'
      ? 'Regional severe warning active. Treat conditions as dangerous and stay indoors.'
      : 'Regional severe watch active. Keep shelter ready and avoid outdoor exposure.';

  return {
    ...status,
    level: minLevel,
    recommendation,
    colorHex: levelColor(minLevel),
  };
}

function applyLocationConfidenceOverride(
  status: SafetyStatus,
  monitoredLocationId: string,
  gpsError: string | null,
): SafetyStatus {
  const usingFallbackDefaultLocation = monitoredLocationId === 'loc-dfw';
  if (!gpsError || !usingFallbackDefaultLocation) {
    return status;
  }

  if (SAFETY_LEVEL_RANK[status.level] >= SAFETY_LEVEL_RANK.caution) {
    return status;
  }

  return {
    ...status,
    level: 'caution',
    colorHex: levelColor('caution'),
    recommendation: 'Location access failed, so safety is uncertain. Allow location or pin your position on the map.',
  };
}

function AreaRiskBanner({ status }: { status: SafetyStatus }) {
  if (status.level !== 'warning' && status.level !== 'danger') {
    return null;
  }

  const isDanger = status.level === 'danger';
  const title = isDanger ? 'Take Cover Now' : 'Lightning In Your Area';
  const subtitle = isDanger
    ? 'Immediate threat nearby. Move indoors and away from windows.'
    : 'Dangerous lightning activity is close. Go indoors now.';
  const distanceLabel = status.closestStrikeKm >= 999 ? 'Unknown' : `${status.closestStrikeKm} km`;

  return (
    <div className="pointer-events-none px-3 pt-3">
      <div className={`rounded-xl border px-4 py-3 shadow-danger backdrop-blur-sm ${isDanger ? 'bg-red-950/90 border-red-400 text-red-100' : 'bg-yellow-300/95 border-yellow-100 text-zinc-950'}`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-mono uppercase tracking-[0.18em] font-bold">
              {title}
            </div>
            <div className="mt-1 text-sm font-display leading-tight">
              {subtitle}
            </div>
          </div>
          <div className="text-right">
            <div className={`text-[10px] font-mono uppercase tracking-widest ${isDanger ? 'opacity-80' : 'text-zinc-700'}`}>closest</div>
            <div className="text-lg font-display font-bold tabular-nums">{distanceLabel}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── NWS Alert Banner ─────────────────────────────────────────────
function NwsAlertBanner({ headline, severity, event, onDismiss }: {
  headline: string;
  severity: string;
  event: string;
  onDismiss: () => void;
}) {
  const isTornado = event.toLowerCase().includes('tornado');
  const isWarning = severity === 'Extreme' || severity === 'Severe' || event.toLowerCase().includes('warning');

  return (
    <div
      role="alert"
      className={`relative flex items-start gap-3 px-4 py-3 text-sm font-mono border-b ${
        isTornado
          ? 'bg-red-950/80 border-red-500 text-red-100'
          : isWarning
          ? 'bg-orange-950/80 border-orange-500 text-orange-100'
          : 'bg-yellow-950/80 border-yellow-600 text-yellow-100'
      }`}
    >
      <span className={`mt-0.5 w-2 h-2 rounded-full flex-shrink-0 animate-pulse ${
        isTornado ? 'bg-red-400' : isWarning ? 'bg-orange-400' : 'bg-yellow-400'
      }`} />
      <div className="flex-1 min-w-0">
        <span className={`uppercase tracking-widest text-[10px] font-bold mr-2 ${
          isTornado ? 'text-red-400' : isWarning ? 'text-orange-400' : 'text-yellow-400'
        }`}>
          {event}
        </span>
        <span className="text-[11px] leading-snug">{headline}</span>
      </div>
      <button
        onClick={onDismiss}
        aria-label="Dismiss alert"
        className="flex-shrink-0 text-storm-400 hover:text-storm-200 transition-colors text-base leading-none"
      >
        ×
      </button>
    </div>
  );
}

// ── Collapsible section wrapper ───────────────────────────────────
function CollapsibleSection({
  title,
  icon,
  children,
  defaultOpen = true,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <button
        className="w-full flex items-center justify-between px-1 py-2 text-left group focus:outline-none"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-mono text-storm-400 group-hover:text-storm-200 transition-colors">
          {icon}
          {title}
        </span>
        <ChevronDownIcon
          className={`w-3.5 h-3.5 text-storm-500 transition-transform duration-200 ${open ? '' : '-rotate-90'}`}
        />
      </button>
      {open && <div className="space-y-3">{children}</div>}
    </div>
  );
}

// ── Dashboard Page ────────────────────────────────────────────────
export default function DashboardPage() {
  const {
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
  } = useLightningFeed();

  const { location, gpsLoading, gpsError, requestGPS, setManualLocation } = useSelectedLocation();
  const [selectedStrikeId, setSelectedStrikeId] = useState<string | null>(null);
  const [dismissedAlertIds, setDismissedAlertIds] = useState<Set<string>>(() => new Set());

  const nwsAlerts = useNwsAlerts(location);
  const visibleAlerts = nwsAlerts.alerts.filter((a) => !dismissedAlertIds.has(a.id));
  const regionalAlertText = nwsAlerts.active && nwsAlerts.alerts.length > 0
    ? nwsAlerts.alerts
      .slice(0, 2)
      .map((alert) => alert.event)
      .join(' · ')
    : null;

  useEffect(() => {
    setMonitoredLocation(location);
  }, [location, setMonitoredLocation]);

  useEffect(() => {
    // Location changes imply a different regional context, so clear dismissed alert state.
    setDismissedAlertIds(new Set());
  }, [location.id]);

  useEffect(() => {
    // Drop dismissed IDs that are no longer present in current alerts to avoid stale suppression.
    const currentIds = new Set(nwsAlerts.alerts.map((alert) => alert.id));
    setDismissedAlertIds((prev) => {
      const next = new Set([...prev].filter((id) => currentIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [nwsAlerts.alerts]);

  useEffect(() => {
    if (selectedStrikeId && !strikes.some((strike) => strike.id === selectedStrikeId)) {
      setSelectedStrikeId(null);
    }
  }, [selectedStrikeId, strikes]);

  const selectedStrike = useMemo<LightningStrike | null>(
    () => strikes.find((strike) => strike.id === selectedStrikeId) ?? null,
    [selectedStrikeId, strikes],
  );
  const effectiveSafetyStatus = useMemo(
    () => applyLocationConfidenceOverride(
      applyRegionalOverride(safetyStatus, nwsAlerts.alerts),
      alertConfig.monitored.id,
      gpsError,
    ),
    [safetyStatus, nwsAlerts.alerts, alertConfig.monitored.id, gpsError],
  );

  const providerName = formatProviderName(feedMeta?.provider);
  const closestStrikeLabel = feedMeta?.closestStrikeKm != null
    ? `${feedMeta.closestStrikeKm.toFixed(1)} km`
    : 'none';
  const resultStateLabel = feedMeta?.resultState ?? (strikes.length > 0 ? 'active' : 'empty');
  const feedDiagnostics = (
    <div className="glass-card w-full max-w-full rounded-xl border border-storm-600 px-3 py-2 shadow-card">
      <div className="text-[10px] font-mono uppercase tracking-widest text-storm-400">
        Feed Diagnostics
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] font-mono">
        <span className="text-storm-500">provider</span>
        <span className="min-w-0 justify-self-end break-words text-right text-storm-200">{providerName}</span>

        <span className="text-storm-500">state</span>
        <span className="min-w-0 justify-self-end break-words text-right uppercase text-storm-200">{resultStateLabel}</span>

        <span className="text-storm-500">closest strike</span>
        <span className="min-w-0 justify-self-end break-words text-right text-bolt-400">{closestStrikeLabel}</span>

        <span className="text-storm-500">monitored</span>
        <span className="min-w-0 justify-self-end break-words text-right text-storm-300">
          {formatCoordinate(alertConfig.monitored.lat, 'N', 'S')} {formatCoordinate(alertConfig.monitored.lng, 'E', 'W')}
        </span>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen flex-col overflow-x-hidden bg-storm-950">
      {/* Sticky header */}
      <Header
        location={alertConfig.monitored}
        status={effectiveSafetyStatus}
        strikeCount={effectiveSafetyStatus.strikeCountLast10min}
        feedStatus={feedStatus}
        feedMessage={feedMessage}
        onRequestGPS={requestGPS}
        gpsLoading={gpsLoading}
      />

      {gpsError && (
        <div className="px-4 py-2 text-[11px] font-mono border-b border-strike-warning/40 bg-orange-950/50 text-orange-200">
          Location access issue: {gpsError}. Monitoring {location.label}. Tap the location button or click the map to pin your area.
        </div>
      )}

      {/* NWS government alert banners */}
      {visibleAlerts.map((alert) => (
        <NwsAlertBanner
          key={alert.id}
          headline={alert.headline}
          severity={alert.severity}
          event={alert.event}
          onDismiss={() => setDismissedAlertIds((prev) => new Set([...prev, alert.id]))}
        />
      ))}

      {/* Main layout: map + sidebar panels */}
      <div className="flex flex-1 flex-col bg-storm-950 lg:min-h-0 lg:flex-row lg:overflow-hidden">
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:overflow-hidden">
          <AreaRiskBanner status={effectiveSafetyStatus} />

          <div className="relative h-[44vh] min-h-[18rem] max-w-full flex-shrink-0 bg-storm-950 lg:h-auto lg:min-h-0 lg:flex-1">
            <LightningMap
              strikes={strikes}
              monitored={alertConfig.monitored}
              alertConfig={alertConfig}
              newestStrikeId={newestStrikeId}
              selectedStrikeId={selectedStrikeId}
              onSelectStrike={(strike) => setSelectedStrikeId(strike.id)}
              onMoveMonitoredLocation={({ lat, lng }) => {
                setManualLocation(lat, lng, 'Pinned Location');
              }}
            />

            <div className="pointer-events-none absolute top-3 right-3 z-[1000] flex items-center gap-2 rounded-xl border border-storm-600 px-3 py-1.5 shadow-card glass-card max-w-[calc(100vw-1.5rem)]">
              <span className="text-bolt-500 font-mono font-bold text-sm tabular-nums">
                {effectiveSafetyStatus.strikeCountLast10min}
              </span>
              <span className="text-[10px] font-mono uppercase tracking-widest text-storm-400">
                active / 10 min
              </span>
            </div>

            <div className="pointer-events-none absolute left-3 top-3 z-[1000] max-w-[calc(100vw-1.5rem)] rounded-xl border border-storm-600 px-3 py-2 shadow-card glass-card">
              <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-storm-300">
                <span className="h-2 w-2 rounded-full bg-plasma-500" /> monitored point
              </div>
              <div className="mt-2 flex max-w-full flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-mono text-storm-400">
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#ff3333]" /> fresh strike</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#8aa0c8]" /> aging strike</span>
              </div>
            </div>

            <div className="pointer-events-none absolute bottom-3 left-3 z-[1000] max-w-[calc(50vw-1.5rem)] text-[9px] font-mono text-storm-500 [text-shadow:0_1px_10px_rgba(0,0,0,0.9)]">
              Preview feed · Not for safety-critical decisions
            </div>

            <div className="pointer-events-none absolute bottom-3 right-3 z-[1000] max-w-[calc(50vw-1.5rem)] text-right text-[9px] font-mono text-storm-500 [text-shadow:0_1px_10px_rgba(0,0,0,0.9)]">
              Leaflet | OpenStreetMap contributors
            </div>
          </div>

          <div className="flex flex-col gap-3 p-3 lg:hidden">
            <MapStrikeInspector
              strike={selectedStrike}
              monitored={alertConfig.monitored}
              onClose={() => setSelectedStrikeId(null)}
            />

            <ThunderETAPanel etas={thunderETAs} />

            <SafetyRadiusPanel status={effectiveSafetyStatus} alertConfig={alertConfig} regionalAlertText={regionalAlertText} />

            <StrikeStatsPanel strikes={strikes} isLive={isLive} feedStatus={feedStatus} feedMeta={feedMeta} />

            {feedDiagnostics}
          </div>
        </div>

        <aside className="hidden flex-shrink-0 overflow-y-auto border-storm-700 bg-storm-950 p-3 lg:block lg:w-80 lg:border-l xl:w-96">
          <div className="space-y-4">
            <MapStrikeInspector
              strike={selectedStrike}
              monitored={alertConfig.monitored}
              onClose={() => setSelectedStrikeId(null)}
            />

            <CollapsibleSection title="Safety Status" defaultOpen>
              <SafetyRadiusPanel status={effectiveSafetyStatus} alertConfig={alertConfig} regionalAlertText={regionalAlertText} />
            </CollapsibleSection>

            <CollapsibleSection title="Thunder ETA" defaultOpen>
              <ThunderETAPanel etas={thunderETAs} />
            </CollapsibleSection>

            <CollapsibleSection title="Strike Feed" defaultOpen={false}>
              <StrikeStatsPanel strikes={strikes} isLive={isLive} feedStatus={feedStatus} feedMeta={feedMeta} />
            </CollapsibleSection>

            {feedDiagnostics}

            <CollapsibleSection
              title="Alert Configuration"
              icon={<BellIcon className="w-3 h-3" />}
              defaultOpen={false}
            >
              <AlertConfigPanel config={alertConfig} onSave={setAlertConfig} />
            </CollapsibleSection>
          </div>
        </aside>
      </div>
    </div>
  );
}
