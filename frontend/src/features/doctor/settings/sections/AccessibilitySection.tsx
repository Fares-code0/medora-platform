import { Contrast, Eye, Keyboard, Type } from 'lucide-react';

import { useInterfaceSettings } from '@/app/providers';
import { TEXT_SCALE_MAX, TEXT_SCALE_MIN } from '@/app/providers/InterfaceSettingsProvider';
import { Button, Switch } from '@/components/ui';

import { OptionCards } from '../components/OptionCards';
import { SettingsCard } from '../components/SettingsCard';
import { SettingsRow, SettingsRowList } from '../components/SettingsRow';

/**
 * Accessibility section — reduce motion, high contrast, keyboard navigation,
 * focus indicators, and text scaling. Every control applies live via the
 * InterfaceSettingsProvider (reflected onto <html>): reduce motion also
 * escalates Framer Motion, high contrast swaps border/text tokens, keyboard
 * navigation shows focus rings for pointer users, and text scaling drives
 * the root `--font-scale`. No save bar — accessibility changes are
 * immediate by design.
 */
export function AccessibilitySection() {
  const { settings, update } = useInterfaceSettings();

  return (
    <div className="flex flex-col gap-5">
      <SettingsCard
        title="Motion & contrast"
        description="Reduce animation and boost contrast for comfort."
        icon={Contrast}
      >
        <SettingsRowList>
          <SettingsRow
            title="Reduce motion"
            description="Minimize animations and transitions across the app."
            control={
              <Switch
                aria-label="Reduce motion"
                checked={settings.reduceMotion}
                onCheckedChange={(reduceMotion) => update({ reduceMotion })}
              />
            }
          />
          <SettingsRow
            title="High contrast"
            description="Darker borders and text for improved legibility."
            control={
              <Switch
                aria-label="High contrast"
                checked={settings.highContrast}
                onCheckedChange={(highContrast) => update({ highContrast })}
              />
            }
          />
        </SettingsRowList>
      </SettingsCard>

      <SettingsCard
        title="Keyboard & focus"
        description="Make focus easier to see and follow."
        icon={Keyboard}
      >
        <div className="flex flex-col gap-4">
          <SettingsRow
            title="Keyboard navigation"
            description="Always show focus outlines, including for mouse users."
            control={
              <Switch
                aria-label="Keyboard navigation"
                checked={settings.keyboardNav}
                onCheckedChange={(keyboardNav) => update({ keyboardNav })}
              />
            }
          />
          <div>
            <span className="mb-2 flex items-center gap-2 text-body-sm font-medium text-text-primary">
              <Eye className="h-4 w-4 text-text-secondary" strokeWidth={1.75} aria-hidden="true" />
              Focus indicators
            </span>
            <OptionCards
              label="Focus indicators"
              columns={2}
              value={settings.focusRings}
              onChange={(focusRings) => update({ focusRings })}
              options={[
                { value: 'default', label: 'Default', description: 'Standard focus ring' },
                { value: 'high', label: 'High visibility', description: 'Thicker, bolder ring' },
              ]}
            />
          </div>
        </div>
      </SettingsCard>

      <SettingsCard title="Text scaling" description="Scale all interface text." icon={Type}>
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-4">
            <Type className="h-3.5 w-3.5 shrink-0 text-text-tertiary" aria-hidden="true" />
            <input
              type="range"
              min={TEXT_SCALE_MIN}
              max={TEXT_SCALE_MAX}
              step={5}
              value={settings.textScale}
              onChange={(event) => update({ textScale: Number(event.target.value) })}
              aria-label="Text scaling"
              aria-valuetext={`${settings.textScale}%`}
              className="h-1.5 flex-1 cursor-pointer appearance-none rounded-pill bg-border accent-primary"
            />
            <Type className="h-5 w-5 shrink-0 text-text-tertiary" aria-hidden="true" />
            <span className="w-12 shrink-0 text-end text-body-sm font-medium text-text-primary tabular-nums">
              {settings.textScale}%
            </span>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-caption text-text-secondary">
              Preview scales with the whole interface.
            </p>
            {settings.textScale !== 100 ? (
              <Button variant="ghost" size="sm" onClick={() => update({ textScale: 100 })}>
                Reset to 100%
              </Button>
            ) : null}
          </div>
        </div>
      </SettingsCard>
    </div>
  );
}
