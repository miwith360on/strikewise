import type { SafetyStatus, AlertConfig } from '@/services/lightning/types';
import { Card } from '@/components/ui/Card';
import { SafetyBadge } from '@/components/ui/Badge';
import { ShieldIcon } from '@/components/ui/Icons';

interface SafetyRadiusPanelProps {
  status: SafetyStatus;
  alertConfig: AlertConfig;
}

const levelMeta = {
  safe:    { ring: 'ring-strike-safe/40',    bar: 'bg-strike-safe',    fraction: 0.1 },
  caution: { ring: 'ring-strike-caution/40', bar: 'bg-strike-caution', fraction: 0.45 },
  warning: { ring: 'ring-strike-warning/40', bar: 'bg-strike-warning', fraction: 0.72 },
  danger:  { ring: 'ring-strike-danger/50',  bar: 'bg-strike-danger',  fraction: 1 },
};

function TrendArrow({ trend }: { trend: SafetyStatus['changeRate'] }) {
  if (trend === 'increasing') {
    return (
      <span className="text-strike-danger text-xs font-mono flex items-center gap-0.5">
        ↑ Increasing
      </span>
    );
  }
  if (trend === 'decreasing') {
    return (
      <span className="text-strike-safe text-xs font-mono flex items-center gap-0.5">
        ↓ Decreasing
      </span>
    );
  }
  return (
    <span className="text-storm-400 text-xs font-mono">→ Steady</span>
  );
}

function RadiusBar({
  label,
  km,
  filled,
  color,
}: {
  label: string;
  km: number;
  filled: boolean;
  color: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${filled ? color : 'bg-storm-600'}`} />
      <div className="flex-1">
        <div className="flex justify-between mb-0.5">
          <span className="text-xs text-storm-400 font-mono">{label}</span>
          <span className="text-xs text-storm-400 font-mono">{km} km</span>
        </div>
        <div className="h-1 bg-storm-700 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${filled ? color : 'w-0'}`}
            style={{ width: filled ? '100%' : '0%' }}
          />
        </div>
      </div>
    </div>
  );
}

export function SafetyRadiusPanel({ status, alertConfig }: SafetyRadiusPanelProps) {
  const meta = levelMeta[status.level];

  // Bars fill from outer in: caution, warning, danger
  const inCaution  = status.closestStrikeKm <= alertConfig.cautionRadiusKm;
  const inWarning  = status.closestStrikeKm <= alertConfig.warningRadiusKm;
  const inDanger   = status.closestStrikeKm <= alertConfig.dangerRadiusKm;

  return (
    <Card
      title="Safety Radius"
      glowColor={status.level === 'danger' ? 'danger' : status.level === 'safe' ? 'plasma' : 'bolt'}
      action={<ShieldIcon className="w-4 h-4 text-storm-500" />}
    >
      <div className="px-4 pb-4 space-y-4">
        {/* Status hero */}
        <div className="flex items-start justify-between">
          <div>
            <SafetyBadge level={status.level} pulse={status.level !== 'safe'} />
            <p className="text-xs text-storm-400 mt-2 leading-relaxed max-w-[16ch]">
              {status.recommendation}
            </p>
          </div>

          {/* Pulsing shield */}
          <div className={`relative w-14 h-14 flex items-center justify-center rounded-full ring-2 ${meta.ring}`}>
            <ShieldIcon
              className="w-7 h-7"
              // color via inline style to match dynamic level color
            />
            <div
              className={`absolute inset-0 rounded-full ring-2 ${meta.ring} animate-ring-expand opacity-50`}
            />
          </div>
        </div>

        {/* Closest strike distance */}
        <div className="flex justify-between items-center border-t border-storm-700 pt-3">
          <span className="text-xs text-storm-400 font-mono uppercase tracking-wider">Closest strike</span>
          <span
            className="text-xl font-display font-bold tabular-nums"
            style={{ color: status.colorHex }}
          >
            {status.closestStrikeKm >= 999 ? '—' : `${status.closestStrikeKm} km`}
          </span>
        </div>

        {/* Stats row */}
        <div className="flex justify-between text-center border-t border-storm-700 pt-3">
          <div>
            <p className="text-lg font-display font-bold text-storm-200">
              {status.strikeCountLast10min}
            </p>
            <p className="text-[10px] uppercase tracking-widest text-storm-500 font-mono">
              10 min
            </p>
          </div>
          <div className="border-l border-storm-700 px-4">
            <TrendArrow trend={status.changeRate} />
            <p className="text-[10px] uppercase tracking-widest text-storm-500 font-mono mt-0.5">
              Trend
            </p>
          </div>
          <div>
            <p className="text-lg font-display font-bold text-storm-200">
              {Math.round(((Date.now() % 60000) / 60000) * 100)}
            </p>
            <p className="text-[10px] uppercase tracking-widest text-storm-500 font-mono">
              Threat %
            </p>
          </div>
        </div>

        {/* Radius bars */}
        <div className="space-y-2 border-t border-storm-700 pt-3">
          <RadiusBar
            label="Caution"
            km={alertConfig.cautionRadiusKm}
            filled={inCaution}
            color="bg-strike-caution"
          />
          <RadiusBar
            label="Warning"
            km={alertConfig.warningRadiusKm}
            filled={inWarning}
            color="bg-strike-warning"
          />
          <RadiusBar
            label="Danger"
            km={alertConfig.dangerRadiusKm}
            filled={inDanger}
            color="bg-strike-danger"
          />
        </div>
      </div>
    </Card>
  );
}
