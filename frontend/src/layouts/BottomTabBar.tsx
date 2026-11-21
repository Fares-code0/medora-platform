import { Menu } from 'lucide-react';
import { useLocation } from 'react-router-dom';

import { useCan } from '@/app/providers';
import { CountBadge } from '@/components/ui';
import { useT } from '@/i18n';
import { cn } from '@/utils/cn';

import { isItemActive } from './active-item';
import { useShellBadges } from './badge-context';
import { type NavigationConfig, type NavigationItem } from './navigation';

/**
 * BottomTabBar — <md navigation (UX §5.1): up to 4 role-configured slots
 * plus "More", which opens the overlay drawer with the full menu. Targets
 * are ≥44px (UX §5.3); active tab uses primary + aria-current.
 */
export interface BottomTabBarProps {
  config: NavigationConfig;
  onMore: () => void;
}

function tabClasses(active: boolean): string {
  return cn(
    // min-w-0 lets tabs shrink below their label width on 320px viewports;
    // labels truncate instead of clipping the bar.
    'relative flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-surface px-1 py-1.5',
    'text-caption font-medium transition-colors duration-fast ease-out',
    active ? 'text-primary' : 'text-text-tertiary hover:text-text-primary',
  );
}

function Tab({
  item,
  label,
  active,
  badgeCount,
  unreadLabel,
}: {
  item: NavigationItem;
  label: string;
  active: boolean;
  badgeCount: number;
  unreadLabel: string;
}) {
  const Icon = item.icon;
  return (
    <a href={item.path} aria-current={active ? 'page' : undefined} className={tabClasses(active)}>
      <span className="relative">
        <Icon aria-hidden="true" className="h-5 w-5" strokeWidth={active ? 2 : 1.75} />
        {badgeCount > 0 ? (
          <CountBadge
            count={badgeCount}
            aria-label={`${String(badgeCount)} ${unreadLabel}`}
            className="absolute -end-2.5 -top-1.5 scale-90"
          />
        ) : null}
      </span>
      <span className="max-w-full truncate">{label}</span>
    </a>
  );
}

export function BottomTabBar({ config, onMore }: BottomTabBarProps) {
  const { pathname } = useLocation();
  const can = useCan();
  const t = useT();
  const badgeCounts = useShellBadges().counts;

  // Matched against EVERY nav path, not just the four tabs, so a deeper
  // section still out-specifies the area index.
  const allPaths = config.sections.flatMap((section) => section.items.map((item) => item.path));

  const items = config.sections
    .flatMap((section) => section.items)
    .filter((item) => !item.requiredPermission || can(item.requiredPermission))
    .filter((item) => config.bottomTabIds.includes(item.id))
    .slice(0, 4);

  return (
    <nav
      aria-label={t('shell.primary')}
      className="sticky bottom-0 z-sticky flex items-stretch gap-1 border-t border-border bg-surface px-2 pb-[env(safe-area-inset-bottom)] pt-1"
    >
      {items.map((item) => (
        <Tab
          key={item.id}
          item={item}
          label={t(item.labelKey)}
          active={isItemActive(pathname, item.path, allPaths, item.end)}
          badgeCount={item.badgeSource ? badgeCounts[item.badgeSource] : 0}
          unreadLabel={t('shell.unread').toLowerCase()}
        />
      ))}
      <button type="button" onClick={onMore} className={tabClasses(false)}>
        <Menu aria-hidden="true" className="h-5 w-5" strokeWidth={1.75} />
        {t('shell.more')}
      </button>
    </nav>
  );
}
