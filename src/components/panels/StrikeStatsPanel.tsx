import { useMemo } from 'react';
import type { FeedStatus, LightningFeedMeta, LightningStrike } from '@/services/lightning/types';
import { BoltIcon } from '@/components/ui/Icons';
import { Button } from '@/components/ui/Button';

interface StrikeStatsPanelProps {
  strikes: LightningStrike[];
  isLive: boolean;
  feedStatus: FeedStatus;
  feedMeta?: LightningFeedMeta | null;
  onExpandRadius?: () => void;
  canExpandRadius?: boolean;
}

function timeAgo(ts: number): string {
  const diffSec = Math.round((Date.now() - ts) / 1000);
  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  return `${Math.floor(diffSec / 60)}m ago`;
}

/** Strikes per minute over the last `windowMs`, split into two halves for trend. */
function computeStrikeRate(strikes: LightningStrike[], windowMs = 5 * 60 * 1000) {
  const now = Date.now();
  const cutoff = now - windowMs;
  const halfpoint = now - windowMs / 2;
  const recent = strikes.filter((s) => s.timestamp >= cutoff);
  const firstHalf = recent.filter((s) => s.timestamp < halfpoint).length;
  const secondHalf = recent.filter((s) => s.timestamp >= halfpoint).length;
  const windowMin = windowMs / 60_000;
  const rate = parseFloat((recent.length / windowMin).toFixed(1));
  let trend: 'rising' | 'falling' | 'steady' = 'steady';
  if (secondHalf > firstHalf * 1.3) trend = 'rising';
  else if (secondHalf < firstHalf * 0.7) trend = 'falling';
  return { rate, trend, count: recent.length };
}

function buildEmptyStateMessage(feedStatus: FeedStatus, feedMeta?: LightningFeedMeta | null): string {
  if (feedStatus === 'unavailable') {
    return 'Live feed is unavailable right now. Reconnecting automatically.';
  }

  if (feedMeta?.simulated) {
    return 'No modeled lightning detected in your current monitored area yet.';
  }

  if (feedMeta?.providerStatus === 'degraded') {
    return 'Coverage is limited right now; no strikes detected in this monitored box.';
  }

  return 'No strikes detected in this monitored box yet.';
}

function readPeakCurrentKa(strike: LightningStrike): number | null {
  if (typeof strike.peakCurrentKa === 'number' && Number.isFinite(strike.peakCurrentKa)) {
    return strike.peakCurrentKa;
  }
  if (typeof strike.peakAmpKa === 'number' && Number.isFinite(strike.peakAmpKa)) {
    return strike.peakAmpKa;
  }
  return null;
}

function formatSecondsAgo(seconds?: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) {
    return '—';
  }

  if (seconds < 60) return `${Math.max(0, Math.round(seconds))}s ago`;
  return `${Math.floor(seconds / 60)}m ago`;
}

function StatTile({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className={`rounded-xl border border-storm-700/80 bg-storm-900/50 px-3 py-2 ${tone}`}>
      <div className="text-[10px] font-mono uppercase tracking-wider text-storm-500">{label}</div>
      <div className="mt-1 text-lg font-display font-bold text-storm-50">{value}</div>
    </div>
  );
}

function LoadingStatTile() {
  return <div className="h-[72px] rounded-xl border border-storm-700/80 bg-storm-900/50 animate-pulse" />;
}

export function StrikeStatsPanel({
  strikes,
  isLive,
  feedStatus,
  feedMeta,
  onExpandRadius,
  canExpandRadius = false,
}: StrikeStatsPanelProps) {
  const sorted = useMemo(() => [...strikes].sort((a, b) => b.timestamp - a.timestamp), [strikes]);
  const recent = useMemo(() => sorted.slice(0, 5), [sorted]);
  const latestStrike = sorted[0] ?? null;

  const { avgIntensity, maxIntensity } = useMemo(() => {
    const measurableCurrents = strikes
      .map(readPeakCurrentKa)
      .filter((value): value is number => value !== null);

    if (measurableCurrents.length === 0) {
      return { avgIntensity: null, maxIntensity: null };
    }

    const avg = Math.round(measurableCurrents.reduce((sum, value) => sum + Math.abs(value), 0) / measurableCurrents.length);
    const max = Math.round(Math.max(...measurableCurrents.map((value) => Math.abs(value))));
    return { avgIntensity: avg, maxIntensity: max };
  }, [strikes]);

  const { rate, trend } = useMemo(() => computeStrikeRate(strikes), [strikes]);
  const trendIcon = trend === 'rising' ? '↑' : trend === 'falling' ? '↓' : '→';
  const trendColor = trend === 'rising' ? 'text-red-400' : trend === 'falling' ? 'text-green-400' : 'text-storm-400';
  const closestLabel = feedMeta?.closestStrikeKm != null ? `${feedMeta.closestStrikeKm.toFixed(1)} km` : '—';
  const latestLabel = feedMeta?.latestStrikeAgeSeconds != null
    ? formatSecondsAgo(feedMeta.latestStrikeAgeSeconds)
    : latestStrike
      ? formatSecondsAgo(Math.max(0, Math.round((Date.now() - latestStrike.timestamp) / 1000)))
      : '—';
  const peakLabel = maxIntensity == null ? '—' : `${maxIntensity} kA`;

  const isLoading = feedStatus === 'connecting' && strikes.length === 0;

  return (
    <div className="glass-card space-y-4 border border-white/5 p-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] font-mono font-semibold uppercase tracking-[0.14em] text-storm-400">
          Recent Strikes
        </span>
        {isLive && (
          <span className="flex items-center gap-1.5 text-[10px] text-strike-safe font-mono uppercase">
            <span className="w-1.5 h-1.5 rounded-full bg-strike-safe animate-pulse" />
            Live
          </span>
        )}
      </div>

      {/* Strike rate */}
      {strikes.length > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-storm-700 bg-storm-900/60 px-3 py-2">
          <span className="text-[10px] font-mono uppercase tracking-wider text-storm-400">Strike Rate</span>
          <span className={`font-mono text-sm font-bold ${trendColor}`}>
            {rate}/min <span className="text-base">{trendIcon}</span>
          </span>
        </div>
      )}

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-2 border-b border-storm-700 pb-3">
        {isLoading ? (
          <>
            <LoadingStatTile />
            <LoadingStatTile />
            <LoadingStatTile />
          </>
        ) : (
          <>
            <StatTile label="Latest" value={latestLabel} tone="ring-1 ring-bolt-500/20" />
            <StatTile label="Closest" value={closestLabel} tone="ring-1 ring-plasma-500/20" />
            <StatTile label="Peak" value={peakLabel} tone="ring-1 ring-storm-500/20" />
          </>
        )}
      </div>

      {/* Secondary stats */}
      <div className="grid grid-cols-2 gap-2 border-b border-storm-700 pb-3">
        {isLoading ? (
          <>
            <LoadingStatTile />
            <LoadingStatTile />
          </>
        ) : (
          <>
            <StatTile label="Total" value={String(strikes.length)} tone="" />
            <StatTile label="Avg kA" value={avgIntensity == null ? '—' : String(avgIntensity)} tone="" />
          </>
        )}
      </div>

      {/* Data source row */}
      {feedMeta && (
        <div className="flex items-center justify-between rounded-lg border border-storm-800 bg-storm-900/40 px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono uppercase tracking-wider text-storm-500">Source</span>
            <span className={`text-[10px] font-mono font-semibold uppercase tracking-wider ${
              feedMeta.providerStatus === 'degraded' ? 'text-strike-warning' : 'text-bolt-400'
            }`}>
              {feedMeta.provider}
            </span>
            {feedMeta.simulated && (
              <span className="text-[9px] font-mono text-storm-600 border border-storm-700 rounded px-1">
                modeled
              </span>
            )}
          </div>
          {feedMeta.dataQualityScore !== undefined && (
            <span className={`text-[10px] font-mono tabular-nums ${
              feedMeta.dataQualityScore >= 80 ? 'text-strike-safe' :
              feedMeta.dataQualityScore >= 60 ? 'text-strike-warning' :
              'text-strike-danger'
            }`}>
              {feedMeta.dataQualityScore}% quality
            </span>
          )}
        </div>
      )}

      {/* Strike feed */}
      <div className="space-y-1.5">
        {isLoading && (
          <div className="space-y-2 rounded-lg border border-storm-700 bg-storm-900/40 p-3">
            <div className="h-3 w-24 rounded bg-storm-700/70 animate-pulse" />
            <div className="h-3 w-5/6 rounded bg-storm-700/70 animate-pulse" />
            <div className="h-3 w-2/3 rounded bg-storm-700/70 animate-pulse" />
          </div>
        )}
        {recent.length === 0 && (
          <div className="rounded-lg border border-storm-700 bg-storm-900/40 p-3">
            <p className="text-xs text-storm-300 font-mono text-center">
              {buildEmptyStateMessage(feedStatus, feedMeta)}
            </p>
            {canExpandRadius && onExpandRadius && (
              <div className="mt-3 flex justify-center">
                <Button variant="outline" size="sm" onClick={onExpandRadius}>
                  Expand Scan Radius
                </Button>
              </div>
            )}
          </div>
        )}
        {recent.map((s, i) => {
          const strikeCurrent = readPeakCurrentKa(s);
          return (
            <div
              key={s.id}
              className={`flex items-center justify-between py-1 px-2 rounded-lg text-xs font-mono ${
                i === 0 ? 'bg-bolt-glow' : ''
              }`}
            >
              <div className="flex items-center gap-2">
                <BoltIcon
                  className={`w-3 h-3 ${i === 0 ? 'text-bolt-500' : 'text-storm-500'}`}
                />
                <span className={i === 0 ? 'text-storm-200' : 'text-storm-500'}>
                  {strikeCurrent === null ? '—' : `${Math.round(Math.abs(strikeCurrent))} kA`}
                </span>
                <span className="text-storm-600">
                  {s.polarity === 'positive' ? '+CG' : '−CG'}
                </span>
              </div>
              <span className={i === 0 ? 'text-bolt-600' : 'text-storm-600'}>
                {timeAgo(s.timestamp)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
