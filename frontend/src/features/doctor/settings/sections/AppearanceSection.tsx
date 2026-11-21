import { Languages, LayoutGrid, Monitor, Moon, Palette, Sun, Type } from 'lucide-react';

import { useInterfaceSettings, useTheme } from '@/app/providers';
import { LocaleSwitcher, useT } from '@/i18n';

import { OptionCards } from '../components/OptionCards';
import { SettingsCard } from '../components/SettingsCard';

/**
 * Appearance section — theme, primary-color preview, density, font size, and
 * language. Everything applies live (Stripe/Linear appearance UX): theme via
 * ThemeProvider, density + font size via InterfaceSettingsProvider (reflected
 * onto <html>), language via LocaleProvider (which sets <html lang>/dir for
 * RTL support). No save bar — the preview IS the confirmation.
 */

const FONT_SCALE_PRESET = { small: 90, default: 100, large: 115 } as const;

function fontPresetOf(scale: number): 'small' | 'default' | 'large' {
  if (scale <= 95) return 'small';
  if (scale >= 110) return 'large';
  return 'default';
}

const COLOR_SWATCHES: readonly { label: string; className: string }[] = [
  { label: 'Primary', className: 'bg-primary' },
  { label: 'Secondary', className: 'bg-secondary' },
  { label: 'Accent', className: 'bg-accent' },
  { label: 'Success', className: 'bg-success' },
  { label: 'Warning', className: 'bg-warning' },
  { label: 'Error', className: 'bg-error' },
];

export function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  const { settings, update } = useInterfaceSettings();
  const t = useT();

  return (
    <div className="flex flex-col gap-5">
      <SettingsCard title="Theme" description="Choose how Medora looks." icon={Palette}>
        <OptionCards
          label="Theme"
          value={theme}
          onChange={setTheme}
          options={[
            { value: 'light', label: 'Light', icon: Sun, description: 'Bright, high-contrast' },
            { value: 'dark', label: 'Dark', icon: Moon, description: 'Easy on the eyes' },
            { value: 'system', label: 'System', icon: Monitor, description: 'Match your device' },
          ]}
        />
      </SettingsCard>

      <SettingsCard
        title="Accent colors"
        description="Medora's palette adapts automatically to your theme."
        icon={Palette}
      >
        <div className="flex flex-wrap gap-4">
          {COLOR_SWATCHES.map((swatch) => (
            <div key={swatch.label} className="flex flex-col items-center gap-1.5">
              <span
                aria-hidden="true"
                // Ring, not border: a border would paint over 1px of the
                // swatch on every side, and the swatch IS the content. The
                // hairline matters most on the palest swatches, which would
                // otherwise have no edge against the panel.
                className={`h-10 w-10 rounded-surface ring-1 ring-border ${swatch.className}`}
              />
              <span className="text-caption text-text-tertiary">{swatch.label}</span>
            </div>
          ))}
        </div>
      </SettingsCard>

      <SettingsCard
        title="Density"
        description="Comfortable gives more breathing room; compact fits more on screen."
        icon={LayoutGrid}
      >
        <OptionCards
          label="Density"
          columns={2}
          value={settings.density}
          onChange={(density) => update({ density })}
          options={[
            { value: 'comfortable', label: 'Comfortable', description: 'Roomier spacing' },
            { value: 'compact', label: 'Compact', description: 'Tighter, denser layout' },
          ]}
        />
      </SettingsCard>

      <SettingsCard title="Font size" description="Scale the interface text." icon={Type}>
        <OptionCards
          label="Font size"
          value={fontPresetOf(settings.textScale)}
          onChange={(preset) => update({ textScale: FONT_SCALE_PRESET[preset] })}
          options={[
            { value: 'small', label: 'Small', description: 'More content per screen' },
            { value: 'default', label: 'Default', description: 'Recommended' },
            { value: 'large', label: 'Large', description: 'Easier to read' },
          ]}
        />
      </SettingsCard>

      <SettingsCard
        title={t('locale.label')}
        description="Interface language. Right-to-left scripts are fully supported."
        icon={Languages}
      >
        {/*
          One switcher, shared with the login screen (F-19). The old copy
          here appended " (RTL)" to Arabic — a label a reader of Arabic does
          not need and cannot read as English. Direction is visible the
          instant it is chosen, which is the better disclosure.
        */}
        <LocaleSwitcher className="max-w-xs" />
      </SettingsCard>
    </div>
  );
}
