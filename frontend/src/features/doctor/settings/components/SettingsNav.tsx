import { Select } from '@/components/ui';
import { routes } from '@/routes';
import { cn } from '@/utils/cn';

import { SETTINGS_SECTIONS, type SettingsSection, type SettingsSectionMeta } from '../model/types';

/**
 * Settings category navigation — grouped section links for the column
 * `SettingsLayout` gives it beside the content (Stripe/Linear/GitHub
 * pattern); the layout owns the column's stickiness. Links are plain
 * `<a href>` so the shell's global internal-link navigation intercepts
 * them for SPA routing. On tablet/mobile the rail collapses to a Select.
 */

const GROUP_ORDER: readonly SettingsSectionMeta['group'][] = ['Account', 'Workspace', 'System'];

export interface SettingsNavProps {
  active: SettingsSection;
  /** Maps a section id to its URL, so any shell can host the nav. */
  buildHref?: (section: SettingsSection) => string;
  onNavigateMobile: (section: SettingsSection) => void;
  /** The sections to list; all of them by default. */
  sections?: readonly SettingsSection[];
}

const doctorHref = (section: SettingsSection) => routes.doctor.settings(section);

export function SettingsNav({
  active,
  buildHref = doctorHref,
  onNavigateMobile,
  sections,
}: SettingsNavProps) {
  const listed =
    sections === undefined
      ? SETTINGS_SECTIONS
      : SETTINGS_SECTIONS.filter((section) => sections.includes(section.id));
  return (
    <>
      {/* Mobile / tablet: a single select. */}
      <div className="lg:hidden">
        <Select
          aria-label="Settings section"
          value={active}
          onChange={(value) => onNavigateMobile(value as SettingsSection)}
          options={listed.map((section) => ({
            value: section.id,
            label: section.label,
            group: section.group,
          }))}
        />
      </div>

      {/* Desktop: sticky grouped rail. */}
      <nav aria-label="Settings" className="hidden lg:block">
        <div className="flex flex-col gap-5">
          {GROUP_ORDER.map((group) => {
            const items = listed.filter((section) => section.group === group);
            if (items.length === 0) return null;
            return (
              <div key={group}>
                <p className="mb-1.5 px-3 text-caption font-semibold uppercase tracking-wider text-text-tertiary">
                  {group}
                </p>
                <ul className="flex flex-col gap-0.5">
                  {items.map((section) => {
                    const selected = section.id === active;
                    const Icon = section.icon;
                    return (
                      <li key={section.id}>
                        <a
                          href={buildHref(section.id)}
                          aria-current={selected ? 'page' : undefined}
                          className={cn(
                            'flex items-center gap-2.5 rounded-surface px-3 py-2 text-body-sm font-medium transition-colors duration-fast touch:min-h-[44px]',
                            selected
                              ? 'bg-primary-subtle text-primary'
                              : 'text-text-secondary hover:bg-surface-sunken hover:text-text-primary',
                          )}
                        >
                          <Icon
                            aria-hidden="true"
                            className="h-4 w-4 shrink-0"
                            strokeWidth={1.75}
                          />
                          {section.label}
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      </nav>
    </>
  );
}
