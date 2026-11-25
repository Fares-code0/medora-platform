import { useCallback, useEffect, useState } from 'react';

import { Settings } from 'lucide-react';
import { useLocation } from 'react-router-dom';

import { useAuth, useCan, useDoctorProfile } from '@/app/providers';
import {
  Avatar,
  Sidebar,
  SidebarGroup,
  SidebarItem,
  SidebarSection,
  SidebarSubItem,
} from '@/components/ui';
import { useT } from '@/i18n';
import { routes } from '@/routes';
import { workspaceFor } from '@/routes/workspaces';
import { Logo } from '@/shared/components/branding';
import { cn } from '@/utils/cn';

import { isItemActive } from '../active-item';
import { useShellBadges } from '../badge-context';
import { type NavigationConfig } from '../navigation';
import { ThemeSwitch } from '../ThemeSwitch';

import { ActiveHospital } from './ActiveHospital';

/**
 * AppSidebar — FRONTEND_ARCHITECTURE.md §4 (layouts/Sidebar).
 * Renders the presentational ui/Sidebar from the role NavigationConfig:
 * permission-filtered items, active detection from the location, live
 * badge counts from the notifications feature, and the bottom-pinned
 * Settings · user card region (UX §2) — there is no separate Help item;
 * Settings → About is reached through Settings — with the light/dark switch
 * just above the account card — no label beside it; the pill names itself
 * for assistive technology. On the collapsed rail it stacks vertically to
 * fit 64px. An item with `children` renders as a SidebarGroup — an inline
 * disclosure when expanded, a flyout on the collapsed rail.
 */
export interface AppSidebarProps {
  config: NavigationConfig;
  collapsed?: boolean;
  /** Called after an item is chosen (used to close the mobile drawer). */
  onNavigate?: (() => void) | undefined;
  className?: string | undefined;
  /**
   * A tighter footer (Settings · theme · account) for the mobile
   * drawer, where vertical space is short: less padding and spacing, 40px
   * rather than 44px touch rows, and room for the home indicator. Type sizes
   * are unchanged. The desktop sidebar never sets it.
   */
  compactFooter?: boolean;
}

function Brand({ collapsed }: { collapsed: boolean }) {
  // Both variants inherit currentColor, so the mark stays theme-aware. The
  // collapsed rail carries the `d·o` ligature alone — same artwork, without
  // the letters there is no room for.
  return (
    <div className={cn('flex h-8 items-center', collapsed ? 'justify-center' : 'px-1')}>
      <Logo size="md" variant={collapsed ? 'mark' : 'lockup'} label="Medora" />
    </div>
  );
}

export function AppSidebar({
  config,
  collapsed = false,
  onNavigate,
  className,
  compactFooter = false,
}: AppSidebarProps) {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const { profile } = useDoctorProfile();
  const can = useCan();
  const badgeCounts = useShellBadges().counts;
  const t = useT();
  const allPaths = config.sections.flatMap((section) => section.items.map((item) => item.path));

  /*
   * The groups are a single-open accordion: one shared `openGroupId`, never a
   * flag per group, so opening one closes whichever was open, and choosing
   * the open one again closes it (all may be shut).
   *
   * Every navigation resets it to the route: the group that holds the
   * current page opens — a direct link, a refresh, back/forward or an in-page
   * button alike — and so closes any other, so leaving Pharmacy for a Medical
   * Records page swaps the two. Between navigations the parents open and shut
   * by hand. Highlighting never depends on it: a parent stays lit, and its
   * current child stays marked, while its list is shut. On the collapsed rail
   * the list is a flyout instead (`flyoutId`, likewise one at a time), never
   * open on its own and closed whenever the route changes.
   */
  const activeGroupId =
    config.sections
      .flatMap((section) => section.items)
      .find(
        (item) =>
          item.children !== undefined && isItemActive(pathname, item.path, allPaths, item.end),
      )?.id ?? null;
  const [openGroupId, setOpenGroupId] = useState<string | null>(activeGroupId);
  const [flyoutId, setFlyoutId] = useState<string | null>(null);
  useEffect(() => {
    setOpenGroupId(activeGroupId);
    setFlyoutId(null);
  }, [activeGroupId, pathname]);
  useEffect(() => setFlyoutId(null), [collapsed]);
  const isOpen = (id: string) => (collapsed ? flyoutId === id : openGroupId === id);
  const setOpen = useCallback(
    (id: string, open: boolean) => {
      if (collapsed) setFlyoutId(open ? id : null);
      // Closing only ever closes this group; opening it replaces any other.
      else setOpenGroupId((current) => (open ? id : current === id ? null : current));
    },
    [collapsed],
  );

  // The administrator's footer link is platform settings; every other role's
  // is its own Settings Center (DEC-006a), which also carries About.
  const settingsPath =
    config.role === 'admin' ? routes.admin.settings() : workspaceFor(config.role).settings();
  const settingsRoot = settingsPath.split('/').slice(0, 3).join('/');

  /*
   * Only a practitioner has a professional profile (`/me/profile`), so only
   * a doctor's footer shows its name, photo and credentials — the avatar
   * menu's rule. The demo seeds the profile for every account, and this
   * footer used to read it regardless: a receptionist was captioned
   * "MD, FACP" under their own name.
   */
  const isDoctor = user?.role === 'doctor';
  const displayName = user ? (isDoctor ? profile.fullName || user.name : user.name) : '';
  const caption = user ? (isDoctor ? profile.title || user.role : user.role) : '';

  return (
    <Sidebar
      collapsed={collapsed}
      className={className}
      header={<Brand collapsed={collapsed} />}
      footerClassName={
        compactFooter ? 'px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]' : undefined
      }
      footer={
        <div
          data-footer-density={compactFooter ? 'compact' : undefined}
          className={cn('flex flex-col', compactFooter ? 'gap-0.5' : 'gap-1')}
        >
          {/* Settings owns every settings section, About included: with no
              separate Help item it stays lit there too. */}
          <SidebarItem
            icon={Settings}
            label={t('shell.settings')}
            href={settingsPath}
            active={pathname.startsWith(settingsRoot)}
            onClick={onNavigate}
            className={compactFooter ? 'touch:h-10' : undefined}
          />
          <div
            className={cn(
              'flex px-3',
              compactFooter ? 'mt-1' : 'mt-2',
              collapsed && 'justify-center px-0',
            )}
          >
            <ThemeSwitch
              orientation={collapsed ? 'vertical' : 'horizontal'}
              hoverLabels={!collapsed}
            />
          </div>
          {user ? (
            <div
              className={cn(
                'mt-1 flex items-center gap-3 px-3',
                compactFooter ? 'py-1' : 'py-2',
                collapsed && 'px-0',
              )}
            >
              <Avatar
                name={displayName}
                src={isDoctor ? (profile.photo ?? undefined) : undefined}
                size="sm"
                roleRing={user.role === 'doctor' || user.role === 'admin' ? user.role : 'staff'}
                decorative
              />
              {!collapsed ? (
                <div className="min-w-0">
                  <p className="truncate text-body-sm font-medium text-text-primary">
                    {displayName}
                  </p>
                  <p className="truncate text-caption text-text-tertiary">{caption}</p>
                  <ActiveHospital />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      }
    >
      {config.sections.map((section, index) => (
        <SidebarSection
          key={section.labelKey ?? `section-${String(index)}`}
          label={section.labelKey ? t(section.labelKey) : undefined}
        >
          {section.items
            .filter((item) => !item.requiredPermission || can(item.requiredPermission))
            .map((item) => {
              const active = isItemActive(pathname, item.path, allPaths, item.end);
              // Children obey their own permission; a child the user may not
              // open is not shown, and a group left with none is a plain item.
              const children = (item.children ?? []).filter(
                (child) => !child.requiredPermission || can(child.requiredPermission),
              );
              if (children.length > 0) {
                const childPaths = children.map((child) => child.path);
                return (
                  <SidebarGroup
                    key={item.id}
                    icon={item.icon}
                    label={t(item.labelKey)}
                    active={active}
                    open={isOpen(item.id)}
                    onOpenChange={(open) => setOpen(item.id, open)}
                  >
                    {children.map((child) => (
                      <SidebarSubItem
                        key={child.id}
                        label={t(child.labelKey)}
                        href={child.path}
                        active={isItemActive(pathname, child.path, childPaths)}
                        onClick={onNavigate}
                      />
                    ))}
                  </SidebarGroup>
                );
              }
              return (
                <SidebarItem
                  key={item.id}
                  icon={item.icon}
                  label={t(item.labelKey)}
                  href={item.path}
                  active={active}
                  badgeCount={item.badgeSource ? badgeCounts[item.badgeSource] : undefined}
                  onClick={onNavigate}
                />
              );
            })}
        </SidebarSection>
      ))}
    </Sidebar>
  );
}
