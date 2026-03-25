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
      className={`glass-card border transition-all duration-300 ${glowClasses[glowColor]} ${className}`}
    >
      {(title || action) && (
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          {title && (
            <span className="text-xs uppercase tracking-widest text-storm-400 font-semibold font-mono">
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
