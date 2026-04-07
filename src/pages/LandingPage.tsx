import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { BoltIcon, RadarIcon, ShieldIcon, ClockIcon } from '@/components/ui/Icons';

// ── Animated lightning bolt SVG ───────────────────────────────────
function HeroBolt() {
  return (
    <div className="relative flex items-center justify-center">
      {/* Glow halos */}
      <div className="absolute w-48 h-48 rounded-full bg-bolt-glow blur-3xl" />
      <div className="absolute w-32 h-32 rounded-full bg-bolt-glow blur-xl animate-ring-expand-slow" />

      {/* Main bolt */}
      <svg
        viewBox="0 0 80 120"
        className="relative w-24 h-36 animate-float drop-shadow-[0_0_30px_rgba(255,224,51,0.8)]"
        fill="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="boltGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="40%" stopColor="#ffe033" />
            <stop offset="100%" stopColor="#ffb300" />
          </linearGradient>
        </defs>
        <polygon
          points="50,4 14,62 38,62 30,116 66,58 42,58"
          fill="url(#boltGrad)"
          stroke="rgba(255,255,255,0.3)"
          strokeWidth="1"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

// ── Feature card ──────────────────────────────────────────────────
interface FeatureCardProps {
  icon: React.ReactNode;
  title: string;
  desc: string;
  delay: string;
}

function FeatureCard({ icon, title, desc, delay }: FeatureCardProps) {
  return (
    <div
      className="glass-card border border-white/5 p-5 flex flex-col gap-3 animate-slide-up"
      style={{ animationDelay: delay, animationFillMode: 'both' }}
    >
      <div className="w-10 h-10 rounded-xl bg-storm-700 flex items-center justify-center text-bolt-500">
        {icon}
      </div>
      <div>
        <h3 className="font-display font-semibold text-storm-100 text-sm">{title}</h3>
        <p className="text-storm-400 text-xs mt-1 leading-relaxed">{desc}</p>
      </div>
    </div>
  );
}

// ── Particle dots background ──────────────────────────────────────
function ParticleDots() {
  const dots = Array.from({ length: 40 }, (_, i) => ({
    id: i,
    top: `${Math.random() * 100}%`,
    left: `${Math.random() * 100}%`,
    opacity: 0.05 + Math.random() * 0.12,
    size: 1 + Math.random() * 2,
    delay: `${Math.random() * 4}s`,
  }));

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
      {dots.map((d) => (
        <span
          key={d.id}
          className="absolute rounded-full bg-bolt-500 animate-pulse"
          style={{
            top: d.top,
            left: d.left,
            opacity: d.opacity,
            width: d.size,
            height: d.size,
            animationDelay: d.delay,
            animationDuration: `${2 + Math.random() * 3}s`,
          }}
        />
      ))}
    </div>
  );
}

// ── Main Landing Page ────────────────────────────────────────────
export default function LandingPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-storm-950 flex flex-col relative overflow-hidden">
      <ParticleDots />

      {/* Gradient background glow */}
      <div
        aria-hidden="true"
        className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-2xl h-96 blur-3xl opacity-20 pointer-events-none bg-[radial-gradient(ellipse_at_50%_0%,#ffe033_0%,transparent_70%)]"
      />

      {/* Nav */}
      <header className="relative z-10 flex items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2">
          <BoltIcon className="w-5 h-5 text-bolt-500" />
          <span className="font-display font-bold text-sm tracking-widest uppercase text-storm-100">
            Strikewise
          </span>
        </div>
        <span className="text-[10px] font-mono uppercase tracking-widest text-storm-500 bg-storm-800 px-2.5 py-1 rounded-full border border-storm-600">
          MVP v0.1
        </span>
      </header>

      {/* Hero */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 text-center gap-8 py-12">
        <HeroBolt />

        <div className="space-y-4 max-w-sm">
          <p className="text-xs uppercase tracking-[0.3em] font-mono text-bolt-500">
            Real-Time Lightning Intelligence
          </p>
          <h1 className="text-4xl sm:text-5xl font-display font-extrabold leading-tight text-white">
            Track.{' '}
            <span className="text-gradient-bolt">Predict.</span>
            <br />
            Stay Safe.
          </h1>
          <p className="text-storm-400 text-sm leading-relaxed">
            Precision strike mapping, thunder arrival countdowns, and smart safety
            radius alerts — purpose-built for people who work and play outdoors.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 w-full max-w-xs">
          <Button
            variant="primary"
            size="lg"
            className="flex-1"
            onClick={() => navigate('/dashboard')}
          >
            <BoltIcon className="w-4 h-4" />
            Open Dashboard
          </Button>
          <Button
            variant="ghost"
            size="lg"
            className="flex-1"
            onClick={() => navigate('/dashboard')}
          >
            See Demo
          </Button>
        </div>

        {/* Live indicator */}
        <div className="flex items-center gap-2 text-xs font-mono text-storm-400">
          <span className="w-2 h-2 rounded-full bg-strike-safe animate-pulse" />
          Live preview feed · Coverage depends on provider
        </div>
      </main>

      {/* Features */}
      <section className="relative z-10 px-5 pb-12 max-w-2xl mx-auto w-full">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <FeatureCard
            icon={<RadarIcon className="w-5 h-5" />}
            title="Live Strike Map"
            desc="Age-encoded markers update in real time."
            delay="0ms"
          />
          <FeatureCard
            icon={<ClockIcon className="w-5 h-5" />}
            title="Thunder ETA"
            desc="Precision countdown to inbound thunder."
            delay="80ms"
          />
          <FeatureCard
            icon={<ShieldIcon className="w-5 h-5" />}
            title="Safety Radius"
            desc="Configurable danger/warning/caution zones."
            delay="160ms"
          />
          <FeatureCard
            icon={<BoltIcon className="w-5 h-5" />}
            title="Smart Alerts"
            desc="Sound + vibration at your custom thresholds."
            delay="240ms"
          />
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 text-center pb-6 text-[10px] font-mono text-storm-600">
        © 2026 Strikewise · Operational preview · Not for safety-critical use
      </footer>
    </div>
  );
}
