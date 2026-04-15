import type { FeedStatus, LightningStrike } from '@/services/lightning/types';
import { BoltIcon } from '@/components/ui/Icons';

interface StrikeStatsPanelProps {
  strikes: LightningStrike[];
  isLive: boolean;
  feedStatus: FeedStatus;
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

export function StrikeStatsPanel({ strikes, isLive, feedStatus }: StrikeStatsPanelProps) {
  const sorted = [...strikes].sort((a, b) => b.timestamp - a.timestamp);
  const recent = sorted.slice(0, 5);
  const avgIntensity =
    strikes.length > 0
      ? Math.round(strikes.reduce((s, k) => s + k.intensityKa, 0) / strikes.length)
      : 0;
  const maxIntensity = strikes.length > 0
    ? Math.round(Math.max(...strikes.map((s) => s.intensityKa)))
    : 0;

  const { rate, trend } = computeStrikeRate(strikes);
  const trendIcon = trend === 'rising' ? '↑' : trend === 'falling' ? '↓' : '→';
  const trendColor = trend === 'rising' ? 'text-red-400' : trend === 'falling' ? 'text-green-400' : 'text-storm-400';

  return (
    <div className="glass-card border border-white/5 p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-widest text-storm-400 font-mono">
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
        <div className="flex items-center justify-between rounded-lg bg-storm-900/60 px-3 py-2 border border-storm-700">
          <span className="text-[10px] font-mono uppercase tracking-wider text-storm-400">Strike Rate</span>
          <span className={`font-mono text-sm font-bold ${trendColor}`}>
            {rate}/min <span className="text-base">{trendIcon}</span>
          </span>
        </div>
      )}

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-2 border-b border-storm-700 pb-3">
        <div className="text-center">
          <p className="text-xl font-display font-bold text-bolt-500">{strikes.length}</p>
          <p className="text-[10px] font-mono uppercase tracking-wider text-storm-500">Total</p>
        </div>
        <div className="text-center border-l border-r border-storm-700">
          <p className="text-xl font-display font-bold text-storm-200">{avgIntensity}</p>
          <p className="text-[10px] font-mono uppercase tracking-wider text-storm-500">Avg kA</p>
        </div>
        <div className="text-center">
          <p className="text-xl font-display font-bold text-plasma-500">{maxIntensity}</p>
          <p className="text-[10px] font-mono uppercase tracking-wider text-storm-500">Peak kA</p>
        </div>
      </div>

      {/* Strike feed */}
      <div className="space-y-1">
        {recent.length === 0 && (
          <p className="text-xs text-storm-500 font-mono text-center py-2">
            {feedStatus === 'unavailable' ? 'Live feed unavailable' : 'Waiting for data…'}
          </p>
        )}
        {recent.map((s, i) => (
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
                {Math.round(s.intensityKa)} kA
              </span>
              <span className="text-storm-600">
                {s.polarity === 'positive' ? '+CG' : '−CG'}
              </span>
            </div>
            <span className={i === 0 ? 'text-bolt-600' : 'text-storm-600'}>
              {timeAgo(s.timestamp)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
