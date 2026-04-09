import { useNavigate } from 'react-router-dom';
import { BoltIcon, LocationIcon } from '@/components/ui/Icons';
import { SafetyBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import type { FeedStatus, SafetyStatus, MonitoredLocation } from '@/services/lightning/types';

interface HeaderProps {
  location: MonitoredLocation;
  status: SafetyStatus;
  strikeCount: number;
  feedStatus: FeedStatus;
  feedMessage: string;
  onRequestGPS: () => void;
  gpsLoading: boolean;
}

export function Header({
  location,
  status,
  strikeCount,
  feedStatus,
  feedMessage,
  onRequestGPS,
  gpsLoading,
}: HeaderProps) {
  const navigate = useNavigate();

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
        </div>
        <div className="flex items-center gap-2">
          {feedStatus === 'live' ? (
            <span className="flex items-center gap-1 text-[10px] font-mono text-strike-safe uppercase tracking-wider">
              <span className="w-1.5 h-1.5 rounded-full bg-strike-safe animate-pulse" />
              Live
            </span>
          ) : feedStatus === 'demo' ? (
            <span className="text-[10px] font-mono text-bolt-500 uppercase tracking-wider">
              Demo feed
            </span>
          ) : feedStatus === 'unavailable' ? (
            <span className="text-[10px] font-mono text-strike-warning uppercase tracking-wider">
              Feed unavailable
            </span>
          ) : (
            <span className="text-[10px] font-mono text-storm-500 uppercase tracking-wider">
              Connecting…
            </span>
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
