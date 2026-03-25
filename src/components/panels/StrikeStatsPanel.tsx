import type { LightningStrike } from '@/services/lightning/types';
import { BoltIcon } from '@/components/ui/Icons';

interface StrikeStatsPanelProps {
  strikes: LightningStrike[];
  isLive: boolean;
}

function timeAgo(ts: number): string {
  const diffSec = Math.round((Date.now() - ts) / 1000);
  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  return `${Math.floor(diffSec / 60)}m ago`;
}

export function StrikeStatsPanel({ strikes, isLive }: StrikeStatsPanelProps) {
  const sorted = [...strikes].sort((a, b) => b.timestamp - a.timestamp);
  const recent = sorted.slice(0, 5);
  const avgIntensity =
    strikes.length > 0
      ? Math.round(strikes.reduce((s, k) => s + k.intensityKa, 0) / strikes.length)
      : 0;
  const maxIntensity = strikes.length > 0
    ? Math.round(Math.max(...strikes.map((s) => s.intensityKa)))
    : 0;

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
          <p className="text-xs text-storm-500 font-mono text-center py-2">Waiting for data…</p>
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
