import type { SafetyLevel } from '@/services/lightning/types';

interface BadgeProps {
  level: SafetyLevel;
  pulse?: boolean;
  className?: string;
}

const config: Record<SafetyLevel, { label: string; bg: string; text: string; ring: string }> = {
  safe:    { label: 'SAFE',    bg: 'bg-strike-safe/10',   text: 'text-strike-safe',   ring: 'ring-strike-safe/30' },
  caution: { label: 'CAUTION', bg: 'bg-strike-caution/10', text: 'text-strike-caution', ring: 'ring-strike-caution/30' },
  warning: { label: 'WARNING', bg: 'bg-strike-warning/10', text: 'text-strike-warning', ring: 'ring-strike-warning/30' },
  danger:  { label: 'DANGER',  bg: 'bg-strike-danger/10', text: 'text-strike-danger',   ring: 'ring-strike-danger/40' },
};

export function SafetyBadge({ level, pulse = false, className = '' }: BadgeProps) {
  const c = config[level];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono font-semibold uppercase tracking-widest ring-1 ${c.bg} ${c.text} ${c.ring} ${className}`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${c.text.replace('text-', 'bg-')} ${pulse ? 'animate-pulse' : ''}`}
      />
      {c.label}
    </span>
  );
}

interface StatBadgeProps {
  value: string | number;
  label: string;
  color?: 'bolt' | 'plasma' | 'muted';
  className?: string;
}

const statColor = {
  bolt: 'text-bolt-500',
  plasma: 'text-plasma-500',
  muted: 'text-storm-400',
};

export function StatBadge({ value, label, color = 'muted', className = '' }: StatBadgeProps) {
  return (
    <div className={`flex flex-col items-center ${className}`}>
      <span className={`text-2xl font-display font-bold ${statColor[color]}`}>{value}</span>
      <span className="text-[10px] uppercase tracking-widest text-storm-400 font-mono">{label}</span>
    </div>
  );
}
