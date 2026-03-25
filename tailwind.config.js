/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        storm: {
          950: '#07080d',
          900: '#0d0f1a',
          800: '#131626',
          700: '#1a1e33',
          600: '#242840',
          500: '#2e3352',
        },
        bolt: {
          DEFAULT: '#ffe033',
          500: '#ffe033',
          400: '#ffea70',
          600: '#ccaf00',
          glow: 'rgba(255,224,51,0.25)',
        },
        plasma: {
          DEFAULT: '#00c8ff',
          500: '#00c8ff',
          400: '#55daff',
          600: '#0099cc',
          glow: 'rgba(0,200,255,0.2)',
        },
        strike: {
          danger: '#ff3333',
          warning: '#ff8800',
          caution: '#ffe033',
          safe: '#00e676',
        },
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      boxShadow: {
        bolt: '0 0 20px rgba(255,224,51,0.4), 0 0 40px rgba(255,224,51,0.15)',
        plasma: '0 0 20px rgba(0,200,255,0.4), 0 0 40px rgba(0,200,255,0.15)',
        danger: '0 0 20px rgba(255,51,51,0.4)',
        card: '0 1px 0 rgba(255,255,255,0.05), 0 4px 24px rgba(0,0,0,0.6)',
      },
      animation: {
        'ring-expand': 'ring-expand 2s ease-out infinite',
        'ring-expand-slow': 'ring-expand 3s ease-out infinite',
        'bolt-flash': 'bolt-flash 0.4s ease-out',
        'float': 'float 4s ease-in-out infinite',
        'scanline': 'scanline 8s linear infinite',
        'bar-fill': 'bar-fill 1s ease-out forwards',
      },
      keyframes: {
        'ring-expand': {
          '0%': { transform: 'scale(1)', opacity: '0.7' },
          '100%': { transform: 'scale(2.5)', opacity: '0' },
        },
        'bolt-flash': {
          '0%': { opacity: '1', transform: 'scale(1.4)' },
          '100%': { opacity: '0.4', transform: 'scale(1)' },
        },
        'float': {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-12px)' },
        },
        'scanline': {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100vh)' },
        },
        'bar-fill': {
          '0%': { width: '0%' },
        },
      },
    },
  },
  plugins: [],
}
