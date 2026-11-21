import type { Role } from '@/types/auth';

import { routes, type DoctorSettingsSection } from './index';

/**
 * Where each role's workspace lives (DEC-006a).
 *
 * One table instead of `role === 'admin' ? … : …` ternaries scattered across
 * the shell, so adding a role is one entry here and the type checker finds
 * every place that has to know about it. A guard, the landing redirect, the
 * sidebar's settings link and the avatar menu all read from this.
 *
 * These are destinations, not authorization: what a workspace may *do* is
 * decided by the server for each request.
 */
export interface Workspace {
  /** Every path inside the workspace starts with this. */
  readonly root: string;
  /** Where a signed-in user of the role lands. */
  readonly home: string;
  /** The role's Settings Center, opened at a section. */
  readonly settings: (section?: DoctorSettingsSection) => string;
  /** The practitioner profile, where the role has one. */
  readonly profile: string | null;
  /** The full notifications page, where the role has one (otherwise the bell drawer only). */
  readonly notifications: string | null;
}

export const WORKSPACES: { readonly [R in Role]: Workspace } = {
  doctor: {
    root: routes.doctor.root,
    home: routes.doctor.overview,
    settings: (section) => routes.doctor.settings(section),
    profile: routes.doctor.settings('profile'),
    notifications: routes.doctor.notifications,
  },
  admin: {
    root: routes.admin.root,
    home: routes.admin.root,
    settings: (section) =>
      section === undefined
        ? routes.admin.section('preferences')
        : `${routes.admin.section('preferences')}/${section}`,
    profile: routes.admin.section('profile'),
    notifications: null,
  },
  reception: {
    root: routes.reception.root,
    home: routes.reception.root,
    settings: (section) => routes.reception.settings(section),
    profile: null,
    notifications: null,
  },
  laboratory: {
    root: routes.laboratory.root,
    home: routes.laboratory.root,
    settings: (section) => routes.laboratory.settings(section),
    profile: null,
    notifications: null,
  },
  pharmacy: {
    root: routes.pharmacy.root,
    home: routes.pharmacy.root,
    settings: (section) => routes.pharmacy.settings(section),
    profile: null,
    notifications: null,
  },
};

export function workspaceFor(role: Role): Workspace {
  return WORKSPACES[role];
}

/** Whether a path lies inside a given role's workspace. */
export function isInWorkspace(path: string, role: Role): boolean {
  const { root } = WORKSPACES[role];
  const bare = path.split('?')[0] ?? path;
  return bare === root || bare.startsWith(`${root}/`);
}
