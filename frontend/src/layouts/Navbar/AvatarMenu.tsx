import { LogOut, Settings, UserRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { useAuth, useDoctorProfile } from '@/app/providers';
import { Avatar, Dropdown, type MenuEntry } from '@/components/ui';
import { useT } from '@/i18n';
import { workspaceFor } from '@/routes/workspaces';

/**
 * Avatar menu — UX §1.2 navbar: profile, theme switch (light/dark pill),
 * settings, sign out. Theme selection applies immediately and persists via
 * the preferences service (ThemeProvider). Role-aware (Phase 19): the same
 * menu serves the doctor workspace and the admin Administration Center —
 * only the profile/settings destinations differ, so both roles get an
 * identical account experience without duplicated chrome.
 */
export function AvatarMenu() {
  const { user, logout } = useAuth();
  const { profile } = useDoctorProfile();
  const navigate = useNavigate();
  const t = useT();

  if (!user) return null;

  const isDoctor = user.role === 'doctor';
  const workspace = workspaceFor(user.role);
  // Only a practitioner has a professional profile behind `/me/profile`.
  const displayName = isDoctor ? profile.fullName || user.name : user.name;
  const profilePath = workspace.profile;
  const settingsPath = workspace.settings();

  const entries: readonly MenuEntry[] = [
    // Staff roles have no profile page (DEC-006a); the entry is absent, not dead.
    ...(profilePath === null
      ? []
      : ([
          {
            id: 'profile',
            label: t('shell.profile'),
            icon: UserRound,
            onSelect: () => navigate(profilePath),
          },
        ] as const)),
    {
      id: 'settings',
      label: t('shell.settings'),
      icon: Settings,
      onSelect: () => navigate(settingsPath),
    },
    // The light/dark switch lives at the foot of the sidebar (ThemeSwitch).
    { type: 'separator', id: 'sep-signout' },
    {
      id: 'sign-out',
      label: t('shell.signOut'),
      icon: LogOut,
      destructive: true,
      onSelect: () => void logout(),
    },
  ];

  return (
    <Dropdown
      align="end"
      menuLabel={t('shell.account')}
      entries={entries}
      trigger={
        <button
          type="button"
          aria-label={`${t('shell.account')} — ${displayName}`}
          // Ring rather than the alias, so the hover affordance survives the
          // token deletion; `ring` also keeps the circular avatar's box
          // unchanged, which a border would not.
          className="touch-target rounded-pill transition-shadow duration-fast [--touch-x:6px] [--touch-y:6px] hover:ring-1 hover:ring-border"
        >
          <Avatar
            name={displayName}
            src={isDoctor ? (profile.photo ?? undefined) : undefined}
            size="sm"
            roleRing={user.role === 'doctor' || user.role === 'admin' ? user.role : 'staff'}
            decorative
          />
        </button>
      }
    />
  );
}
