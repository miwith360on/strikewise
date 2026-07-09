import type { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
  glowColor?: 'bolt' | 'plasma' | 'danger' | 'none';
  title?: string;
  action?: ReactNode;
}

const glowClasses: Record<NonNullable<CardProps['glowColor']>, string> = {
  bolt: 'border-bolt-500/20 shadow-bolt',
  plasma: 'border-plasma-500/20 shadow-plasma',
  danger: 'border-strike-danger/20 shadow-danger',
  none: 'border-white/5',
};

export function Card({ children, className = '', glowColor = 'none', title, action }: CardProps) {
  return (
    <div
      className={`glass-card border transition-[border-color,box-shadow,transform] duration-200 ease-out ${glowClasses[glowColor]} ${className}`}
    >
      {(title || action) && (
        <div className="flex min-h-9 items-center justify-between px-4 pt-4 pb-3">
          {title && (
            <span className="text-[11px] uppercase tracking-[0.14em] text-storm-400 font-semibold font-mono">
              {title}
            </span>
          )}
          {action}
        </div>
      )}
      {children}
    </div>
  );
}
