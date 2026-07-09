import { useState } from 'react';
import type { AlertConfig } from '@/services/lightning/types';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { BellIcon, SoundOnIcon, SoundOffIcon } from '@/components/ui/Icons';

interface AlertConfigPanelProps {
  config: AlertConfig;
  onSave: (config: AlertConfig) => void;
}

interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  color: string;
  onChange: (v: number) => void;
}

function colorClass(color: string): string {
  if (color === '#ff3333') return 'text-red-400';
  if (color === '#ff8800') return 'text-orange-400';
  if (color === '#ffe033') return 'text-yellow-300';
  if (color === '#00c8ff') return 'text-cyan-300';
  return 'text-storm-200';
}

function sliderAccentClass(color: string): string {
  if (color === '#ff3333') return 'accent-red-500';
  if (color === '#ff8800') return 'accent-orange-500';
  if (color === '#ffe033') return 'accent-yellow-400';
  if (color === '#00c8ff') return 'accent-cyan-400';
  return 'accent-storm-400';
}

function SliderRow({ label, value, min, max, step, unit, color, onChange }: SliderRowProps) {
  const valueColorClass = colorClass(color);
  const accentClass = sliderAccentClass(color);

  return (
    <div className="space-y-1.5">
      <div className="flex justify-between items-center">
        <span className="text-xs text-storm-300 font-mono">{label}</span>
        <span className={`text-sm font-mono font-semibold ${valueColorClass}`}>
          {value} {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={`w-full h-1.5 cursor-pointer rounded-lg bg-storm-700 ${accentClass}`}
        aria-label={label}
      />
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  icon,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  icon?: React.ReactNode;
}) {
  return (
    <label className="flex items-center justify-between cursor-pointer select-none">
      <span className="flex items-center gap-2 text-sm text-storm-300 font-mono">
        {icon}
        {label}
      </span>
      <span className="relative inline-flex items-center">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
          aria-label={label}
        />
        <span
          className={`relative w-10 h-5 rounded-full transition-colors duration-200 peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-bolt-500 ${
          checked ? 'bg-bolt-500' : 'bg-storm-700'
        }`}
        >
        <span
          className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
        </span>
      </span>
    </label>
  );
}

export function AlertConfigPanel({ config, onSave }: AlertConfigPanelProps) {
  const [draft, setDraft] = useState<AlertConfig>(config);
  const [saved, setSaved] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  function update<K extends keyof AlertConfig>(key: K, value: AlertConfig[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
    setValidationError(null);
  }

  function handleSave() {
    if (draft.dangerRadiusKm >= draft.warningRadiusKm) {
      setValidationError('Warning zone must be larger than Danger zone');
      return;
    }
    if (draft.warningRadiusKm >= draft.cautionRadiusKm) {
      setValidationError('Caution zone must be larger than Warning zone');
      return;
    }
    setValidationError(null);
    onSave(draft);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <Card
      title="Alert Config"
      glowColor="none"
      action={<BellIcon className="w-4 h-4 text-storm-500" />}
    >
      <div className="space-y-4 px-4 pb-4">
        {/* Radius thresholds */}
        <div className="space-y-3 border-b border-storm-700 pb-4">
          <p className="text-[11px] font-mono font-semibold uppercase tracking-[0.14em] text-storm-500">
            Radius Thresholds
          </p>
          <SliderRow
            label="Danger Zone"
            value={draft.dangerRadiusKm}
            min={2}
            max={20}
            step={1}
            unit="km"
            color="#ff3333"
            onChange={(v) => update('dangerRadiusKm', v)}
          />
          <SliderRow
            label="Warning Zone"
            value={draft.warningRadiusKm}
            min={draft.dangerRadiusKm + 1}
            max={40}
            step={1}
            unit="km"
            color="#ff8800"
            onChange={(v) => update('warningRadiusKm', v)}
          />
          <SliderRow
            label="Caution Zone"
            value={draft.cautionRadiusKm}
            min={draft.warningRadiusKm + 1}
            max={80}
            step={5}
            unit="km"
            color="#ffe033"
            onChange={(v) => update('cautionRadiusKm', v)}
          />
        </div>

        {/* Notification toggles */}
        <div className="space-y-3 border-b border-storm-700 pb-4">
          <p className="text-[11px] font-mono font-semibold uppercase tracking-[0.14em] text-storm-500">
            Notifications
          </p>
          <Toggle
            label="Sound alerts"
            checked={draft.soundEnabled}
            onChange={(v) => update('soundEnabled', v)}
            icon={
              draft.soundEnabled
                ? <SoundOnIcon className="w-3.5 h-3.5 text-bolt-500" />
                : <SoundOffIcon className="w-3.5 h-3.5 text-storm-500" />
            }
          />
          <Toggle
            label="Vibration"
            checked={draft.vibrationEnabled}
            onChange={(v) => update('vibrationEnabled', v)}
          />
        </div>

        {/* Repeat interval */}
        <div className="border-b border-storm-700 pb-4">
          <p className="mb-2 text-[11px] font-mono font-semibold uppercase tracking-[0.14em] text-storm-500">
            Repeat Alerts
          </p>
          <SliderRow
            label="Repeat interval"
            value={draft.repeatIntervalSec}
            min={15}
            max={300}
            step={15}
            unit="sec"
            color="#00c8ff"
            onChange={(v) => update('repeatIntervalSec', v)}
          />
        </div>

        {/* Save */}
        {validationError && (
          <p className="text-xs text-red-400 font-mono text-center">{validationError}</p>
        )}
        <Button
          variant={saved ? 'ghost' : 'primary'}
          size="sm"
          className="min-h-10 w-full"
          onClick={handleSave}
        >
          {saved ? '✓ Saved' : 'Apply Changes'}
        </Button>
      </div>
    </Card>
  );
}
