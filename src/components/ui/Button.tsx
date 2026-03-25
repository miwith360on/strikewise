import type { ReactNode, ButtonHTMLAttributes } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost' | 'danger' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  children: ReactNode;
}

const base =
  'inline-flex items-center justify-center gap-2 rounded-xl font-display font-semibold transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-bolt-500 disabled:opacity-40 disabled:cursor-not-allowed select-none';

const variants: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary:
    'bg-bolt-500 text-storm-950 hover:bg-bolt-400 active:scale-95 shadow-bolt focus-visible:ring-bolt-400',
  ghost:
    'bg-transparent text-bolt-500 hover:bg-storm-700 active:scale-95',
  danger:
    'bg-strike-danger/10 text-strike-danger border border-strike-danger/30 hover:bg-strike-danger/20 active:scale-95',
  outline:
    'bg-transparent text-storm-400 border border-storm-600 hover:border-bolt-500 hover:text-bolt-500 active:scale-95',
};

const sizes: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-5 py-2.5 text-sm',
  lg: 'px-7 py-3.5 text-base',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} {...rest}>
      {children}
    </button>
  );
}
