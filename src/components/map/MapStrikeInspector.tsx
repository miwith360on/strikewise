import type { LightningStrike, MonitoredLocation } from '@/services/lightning/types';
import { haversineKm } from '@/services/lightning/geo';
import { BoltIcon, ClockIcon, LocationIcon } from '@/components/ui/Icons';

const SOUND_SPEED_KM_S = 0.343;

function strikeTypeLabel(strikeType?: LightningStrike['strikeType']) {
  if (strikeType === 'cg') return 'Cloud-to-Ground';
  if (strikeType === 'ic') return 'In-Cloud';
  return 'Unknown';
}

function strikeAgeSeconds(strike: LightningStrike) {
  if (typeof strike.ageSeconds === 'number' && Number.isFinite(strike.ageSeconds)) {
    return Math.max(0, Math.round(strike.ageSeconds));
  }
  return Math.max(0, Math.round((Date.now() - strike.timestamp) / 1000));
}

function signedPeakAmp(strike: LightningStrike) {
  if (typeof strike.peakAmpKa === 'number' && Number.isFinite(strike.peakAmpKa)) {
    return strike.peakAmpKa;
  }
  return strike.polarity === 'positive' ? strike.intensityKa : -strike.intensityKa;
}

function formatAge(timestamp: number) {
  const ageSec = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (ageSec < 60) return `${ageSec}s ago`;
  return `${Math.floor(ageSec / 60)}m ${ageSec % 60}s ago`;
}

function formatETA(distanceKm: number, timestamp: number) {
  const ageAtLocationSec = (Date.now() - timestamp) / 1000;
  const etaSeconds = distanceKm / SOUND_SPEED_KM_S - ageAtLocationSec;

  if (etaSeconds <= 0) return 'Thunder passed';
  if (etaSeconds < 60) return `${Math.round(etaSeconds)} sec`;
  return `${Math.floor(etaSeconds / 60)}m ${Math.round(etaSeconds % 60)}s`;
}

interface MapStrikeInspectorProps {
  strike: LightningStrike | null;
  monitored: MonitoredLocation;
  onClose: () => void;
}

export function MapStrikeInspector({ strike, monitored, onClose }: MapStrikeInspectorProps) {
  if (!strike) {
    return (
      <div className="glass-card border border-white/5 px-4 py-3 rounded-2xl w-full max-w-sm">
        <div className="flex items-center gap-2 text-storm-300">
          <BoltIcon className="w-4 h-4 text-bolt-500" />
          <span className="text-xs font-mono uppercase tracking-widest">Map Inspector</span>
        </div>
        <p className="mt-3 text-sm text-storm-300 leading-relaxed">
          Tap a strike to inspect current, age, polarity, and thunder ETA. Tap anywhere on the map to move the monitored point.
        </p>
      </div>
    );
  }

  const distanceKm = haversineKm(monitored.lat, monitored.lng, strike.lat, strike.lng);
  const signedAmp = signedPeakAmp(strike);
  const ampLabel = `${signedAmp >= 0 ? '+' : ''}${Math.round(signedAmp)} kA`;

  return (
    <div className="glass-card border border-bolt-500/20 shadow-bolt px-4 py-3 rounded-2xl w-full max-w-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-bolt-500">
            <BoltIcon className="w-4 h-4" />
            <span className="text-xs font-mono uppercase tracking-widest">Selected Strike</span>
          </div>
          <p className="mt-2 text-2xl font-display font-bold text-storm-50">
            {ampLabel}
          </p>
        </div>
        <button
          onClick={onClose}
          className="rounded-md text-storm-500 hover:text-storm-200 transition-colors text-lg leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bolt-500 focus-visible:ring-offset-2 focus-visible:ring-offset-storm-950"
          aria-label="Close strike inspector"
        >
          ×
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-xs font-mono">
        <div className="rounded-xl bg-storm-800/70 px-3 py-2">
          <div className="text-storm-500 uppercase tracking-widest">Distance</div>
          <div className="mt-1 text-storm-100 text-sm">{distanceKm.toFixed(1)} km</div>
        </div>
        <div className="rounded-xl bg-storm-800/70 px-3 py-2">
          <div className="text-storm-500 uppercase tracking-widest">Thunder ETA</div>
          <div className="mt-1 text-storm-100 text-sm">{formatETA(distanceKm, strike.timestamp)}</div>
        </div>
        <div className="rounded-xl bg-storm-800/70 px-3 py-2">
          <div className="text-storm-500 uppercase tracking-widest">Polarity</div>
          <div className="mt-1 text-storm-100 text-sm capitalize">{strike.polarity}</div>
        </div>
        <div className="rounded-xl bg-storm-800/70 px-3 py-2">
          <div className="text-storm-500 uppercase tracking-widest">Type</div>
          <div className="mt-1 text-storm-100 text-sm">{strikeTypeLabel(strike.strikeType)}</div>
        </div>
      </div>

      <div className="mt-4 space-y-2 text-xs font-mono text-storm-300">
        <div className="flex items-center gap-2">
          <ClockIcon className="w-3.5 h-3.5 text-storm-500" />
          <span>{formatAge(Date.now() - strikeAgeSeconds(strike) * 1000)}</span>
        </div>
        <div className="flex items-center gap-2">
          <LocationIcon className="w-3.5 h-3.5 text-plasma-500" />
          <span>
            {strike.lat.toFixed(3)}, {strike.lng.toFixed(3)} relative to {monitored.label}
          </span>
        </div>
      </div>
    </div>
  );
}