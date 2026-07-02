import { useNavigate } from 'react-router-dom';
import { BoltIcon, LocationIcon } from '@/components/ui/Icons';
import { SafetyBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import type {
  FeedStatus,
  LightningFeedMeta,
  SafetyStatus,
  MonitoredLocation,
} from '@/services/lightning/types';

interface HeaderProps {
  location: MonitoredLocation;
  status: SafetyStatus;
  strikeCount: number;
  feedStatus: FeedStatus;
  feedMessage: string;
  feedMeta?: LightningFeedMeta | null;
  locationConfidence: 'high' | 'low';
  onRequestGPS: () => void;
  gpsLoading: boolean;
}

function getFeedIndicator(
  feedStatus: FeedStatus,
  feedMeta?: LightningFeedMeta | null,
): { label: string; className: string; dotClassName?: string } {
  if (feedStatus === 'connecting') {
    return {
      label: 'Connecting...',
      className: 'text-[10px] font-mono text-storm-500 uppercase tracking-wider',
    };
  }

  if (feedStatus === 'demo') {
    return {
      label: 'Demo feed',
      className: 'text-[10px] font-mono text-bolt-500 uppercase tracking-wider',
    };
  }

  if (feedStatus === 'unavailable' || feedMeta?.provider === 'error') {
    return {
      label: 'No providers',
      className: 'text-[10px] font-mono text-storm-400 uppercase tracking-wider',
    };
  }

  const provider = (feedMeta?.provider ?? '').toLowerCase();
  const source = (feedMeta?.source ?? '').toLowerCase();
  const isGlmFallback = provider.includes('glm') || provider.includes('noaa') || source.includes('noaa');

  if (isGlmFallback) {
    return {
      label: 'GLM fallback',
      className: 'text-[10px] font-mono text-strike-warning uppercase tracking-wider',
    };
  }

  return {
    label: 'Live',
    className: 'flex items-center gap-1 text-[10px] font-mono text-strike-safe uppercase tracking-wider',
    dotClassName: 'w-1.5 h-1.5 rounded-full bg-strike-safe animate-pulse',
  };
}

export function Header({
  location,
  status,
  strikeCount,
  feedStatus,
  feedMessage,
  feedMeta,
  locationConfidence,
  onRequestGPS,
  gpsLoading,
}: HeaderProps) {
  const navigate = useNavigate();
  const indicator = getFeedIndicator(feedStatus, feedMeta);

  return (
    <header className="flex items-center justify-between px-4 py-3 border-b border-storm-700 bg-storm-900/80 backdrop-blur-sm sticky top-0 z-50">
      {/* Brand */}
      <button
        className="flex items-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-bolt-500 rounded-lg"
        onClick={() => navigate('/')}
        aria-label="Go to landing page"
      >
        <BoltIcon className="w-5 h-5 text-bolt-500" />
        <span className="font-display font-bold text-sm tracking-widest uppercase text-storm-100 hidden sm:inline">
          Strikewise
        </span>
      </button>

      {/* Center: location + live indicator */}
      <div className="flex flex-col items-center gap-0.5">
        <div className="flex items-center gap-1.5">
          <LocationIcon className="w-3 h-3 text-plasma-500" />
          <span className="text-xs font-mono text-storm-200 truncate max-w-[120px]">
            {location.label}
          </span>
          <span
            className={`rounded px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider border ${
              locationConfidence === 'high'
                ? 'border-strike-safe/40 text-strike-safe bg-strike-safe/10'
                : 'border-strike-caution/40 text-strike-caution bg-strike-caution/10'
            }`}
            title={locationConfidence === 'high' ? 'GPS or pinned location confidence is high' : 'Location confidence is low; verify your monitored point'}
          >
            {locationConfidence === 'high' ? 'Precise' : 'Approx'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {indicator.dotClassName ? (
            <span className={indicator.className}>
              <span className={indicator.dotClassName} />
              {indicator.label}
            </span>
          ) : (
            <span className={indicator.className}>{indicator.label}</span>
          )}
          <span className="text-[10px] font-mono text-storm-500">
            {strikeCount} strikes / 10 min
          </span>
        </div>
        <div className="text-[10px] font-mono text-storm-500 truncate max-w-[220px]">
          {feedMessage}
        </div>
      </div>

      {/* Right: safety badge + GPS */}
      <div className="flex items-center gap-2">
        <SafetyBadge level={status.level} pulse={status.level !== 'safe'} />
        <Button
          variant="ghost"
          size="sm"
          onClick={onRequestGPS}
          disabled={gpsLoading}
          className="px-2 py-1.5 text-xs hidden sm:flex"
          title="Use my location"
        >
          <LocationIcon className="w-3.5 h-3.5" />
        </Button>
      </div>
    </header>
  );
}
