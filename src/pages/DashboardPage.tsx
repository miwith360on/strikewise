import { useEffect, useMemo, useState } from 'react';
import { useLightningFeed } from '@/hooks/useLightningFeed';
import { useSelectedLocation } from '@/hooks/useSelectedLocation';
import { LightningMap } from '@/components/map/LightningMap';
import { MapStrikeInspector } from '@/components/map/MapStrikeInspector';
import { ThunderETAPanel } from '@/components/panels/ThunderETAPanel';
import { SafetyRadiusPanel } from '@/components/panels/SafetyRadiusPanel';
import { AlertConfigPanel } from '@/components/panels/AlertConfigPanel';
import { StrikeStatsPanel } from '@/components/panels/StrikeStatsPanel';
import { Header } from '@/components/layout/Header';
import { BellIcon, ChevronDownIcon } from '@/components/ui/Icons';
import type { LightningStrike } from '@/services/lightning/types';

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
        aria-expanded={open ? 'true' : 'false'}
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
    setAlertConfig,
    setMonitoredLocation,
  } = useLightningFeed();

  const { location, gpsLoading, requestGPS, setManualLocation } = useSelectedLocation();
  const [selectedStrikeId, setSelectedStrikeId] = useState<string | null>(null);

  useEffect(() => {
    setMonitoredLocation(location);
  }, [location, setMonitoredLocation]);

  useEffect(() => {
    if (selectedStrikeId && !strikes.some((strike) => strike.id === selectedStrikeId)) {
      setSelectedStrikeId(null);
    }
  }, [selectedStrikeId, strikes]);

  const selectedStrike = useMemo<LightningStrike | null>(
    () => strikes.find((strike) => strike.id === selectedStrikeId) ?? null,
    [selectedStrikeId, strikes],
  );

  return (
    <div className="flex flex-col h-screen bg-storm-950 overflow-hidden">
      {/* Sticky header */}
      <Header
        location={alertConfig.monitored}
        status={safetyStatus}
        strikeCount={safetyStatus.strikeCountLast10min}
        feedStatus={feedStatus}
        feedMessage={feedMessage}
        onRequestGPS={requestGPS}
        gpsLoading={gpsLoading}
      />

      {/* Main layout: map + sidebar panels */}
      <div className="flex flex-col lg:flex-row flex-1 overflow-hidden">
        {/* ── Lightning Map (dominant panel) ─────────────────────── */}
        <div className="relative flex-shrink-0 h-[50vh] lg:h-full lg:flex-1">
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

          {/* Map overlay: strike counter badge */}
          <div className="absolute top-3 right-3 z-[1000] glass-card border border-storm-600 px-3 py-1.5 rounded-xl flex items-center gap-2 shadow-card pointer-events-none">
            <span className="text-bolt-500 font-mono font-bold text-sm tabular-nums">
              {safetyStatus.strikeCountLast10min}
            </span>
            <span className="text-[10px] font-mono uppercase tracking-widest text-storm-400">
              active / 10 min
            </span>
          </div>

          <div className="absolute top-3 left-3 z-[1000] glass-card border border-storm-600 px-3 py-2 rounded-xl shadow-card pointer-events-none">
            <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-storm-300">
              <span className="w-2 h-2 rounded-full bg-plasma-500" /> monitored point
            </div>
            <div className="mt-2 flex items-center gap-3 text-[10px] font-mono text-storm-400">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-bolt-500" /> fresh strike</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#992200]" /> aging strike</span>
            </div>
          </div>

          <div className="absolute bottom-12 right-3 z-[1000] w-[min(22rem,calc(100%-1.5rem))]">
            <MapStrikeInspector
              strike={selectedStrike}
              monitored={alertConfig.monitored}
              onClose={() => setSelectedStrikeId(null)}
            />
          </div>

          {/* Map overlay: data attribution note */}
          <div className="absolute bottom-8 left-3 z-[1000] text-[9px] font-mono text-storm-600 pointer-events-none">
            Preview feed · Not for safety-critical decisions
          </div>
        </div>

        {/* ── Side panel ──────────────────────────────────────────── */}
        <aside className="flex-shrink-0 lg:w-80 xl:w-96 overflow-y-auto bg-storm-950 border-t lg:border-t-0 lg:border-l border-storm-700 p-3 space-y-4">

          {/* Safety status */}
          <CollapsibleSection title="Safety Status" defaultOpen>
            <SafetyRadiusPanel status={safetyStatus} alertConfig={alertConfig} />
          </CollapsibleSection>

          {/* Thunder ETA */}
          <CollapsibleSection title="Thunder ETA" defaultOpen>
            <ThunderETAPanel etas={thunderETAs} />
          </CollapsibleSection>

          {/* Strike feed */}
          <CollapsibleSection title="Strike Feed" defaultOpen={false}>
            <StrikeStatsPanel strikes={strikes} isLive={isLive} feedStatus={feedStatus} />
          </CollapsibleSection>

          {/* Alert config */}
          <CollapsibleSection
            title="Alert Configuration"
            icon={<BellIcon className="w-3 h-3" />}
            defaultOpen={false}
          >
            <AlertConfigPanel config={alertConfig} onSave={setAlertConfig} />
          </CollapsibleSection>

          {/* Bottom spacer for mobile scroll */}
          <div className="h-4 lg:hidden" />
        </aside>
      </div>
    </div>
  );
}
