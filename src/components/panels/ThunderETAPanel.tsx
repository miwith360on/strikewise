import type { ThunderETAEntry } from '@/services/lightning/types';
import { Card } from '@/components/ui/Card';
import { ClockIcon } from '@/components/ui/Icons';

interface ThunderETAPanelProps {
  etas: ThunderETAEntry[];
}

function ETARow({ entry }: { entry: ThunderETAEntry }) {
  const isImminent = entry.etaSeconds <= 10;
  const isArriving = entry.etaSeconds <= 30;

  return (
    <div
      className={`flex items-center justify-between px-3 py-2 rounded-lg transition-colors ${
        isImminent ? 'bg-strike-danger/10 border border-strike-danger/20' :
        isArriving ? 'bg-strike-warning/10 border border-strike-warning/10' :
        'bg-storm-800/60 border border-transparent'
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`w-2 h-2 rounded-full flex-shrink-0 ${
            isImminent ? 'bg-strike-danger animate-pulse' :
            isArriving ? 'bg-strike-warning animate-pulse' :
            'bg-bolt-600'
          }`}
        />
        <span className="text-xs font-mono text-storm-400">
          {Math.round(entry.distanceKm * 10) / 10} km
        </span>
        <span className="text-xs text-storm-500">·</span>
        <span className="text-xs font-mono text-storm-400">
          {Math.round(entry.intensityKa)} kA
        </span>
      </div>

      <span
        className={`text-sm font-mono font-semibold tabular-nums ${
          isImminent ? 'text-strike-danger glow-danger animate-countdown-tick' :
          isArriving ? 'text-strike-warning' :
          'text-bolt-500'
        }`}
      >
        {entry.etaRangeLabel}
      </span>
    </div>
  );
}

export function ThunderETAPanel({ etas }: ThunderETAPanelProps) {
  const nearest = etas[0];

  return (
    <Card
      title="Thunder ETA"
      glowColor={nearest && nearest.etaSeconds <= 30 ? 'danger' : 'bolt'}
      className="flex flex-col"
      action={
        <ClockIcon className="w-4 h-4 text-storm-500" />
      }
    >
      <div className="px-4 pb-4 space-y-3">
        {etas.length === 0 ? (
          <div className="text-center py-6">
            <p className="text-storm-500 text-sm font-mono">No inbound thunder</p>
            <p className="text-storm-600 text-xs mt-1">Skies are quiet</p>
          </div>
        ) : (
          <>
            {/* Hero ETA */}
            <div className="text-center py-3 border-b border-storm-700">
              <p className="text-xs uppercase tracking-widest text-storm-400 font-mono mb-1">
                Closest Strike
              </p>
              <p
                className={`text-4xl font-display font-bold tabular-nums ${
                  nearest.etaSeconds <= 10 ? 'text-strike-danger glow-danger' :
                  nearest.etaSeconds <= 30 ? 'text-strike-warning' :
                  'text-bolt-500 glow-bolt'
                }`}
              >
                {nearest.etaRangeLabel}
              </p>
              <p className="text-xs text-storm-400 mt-1 font-mono">
                {Math.round(nearest.distanceKm * 10) / 10} km · {Math.round(nearest.intensityKa)} kA
              </p>
            </div>

            {/* Queue */}
            <div className="space-y-1.5">
              {etas.slice(0, 4).map((e) => (
                <ETARow key={e.strikeId} entry={e} />
              ))}
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
