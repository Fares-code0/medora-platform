import { useCallback, useMemo } from 'react';

import { useT } from '@/i18n';
import type { ShellSearchResult, ShellSearchValue } from '@/layouts';
import { routes } from '@/routes';

import { SETTINGS_PANELS } from './admin-settings.types';
import { SECTION_META, STAFF_ROLE_LABEL } from './administration.meta';
import {
  useAnnouncements,
  useDepartments,
  usePolicies,
  useResources,
  useRooms,
  useStaff,
  useTemplates,
} from './api/useAdministrationQueries';

/**
 * Cross-section search for the administration area (Phase 17, moved into the
 * shared shell in Phase B). Indexes the entity datasets TanStack Query has
 * already cached — staff, departments, rooms, resources, announcements,
 * policies, templates — plus every settings panel, and matches the term
 * against their primary fields.
 *
 * Returns the domain-free `ShellSearchValue` the navbar consumes, so the
 * feature keeps ownership of its index while the shell stays domain-free.
 */
export function useAdminSearchIndex(): ShellSearchValue {
  const t = useT();
  const staff = useStaff();
  const departments = useDepartments();
  const rooms = useRooms();
  const resources = useResources();
  const announcements = useAnnouncements();
  const policies = usePolicies();
  const templates = useTemplates();

  const index = useMemo<readonly ShellSearchResult[]>(() => {
    const results: ShellSearchResult[] = [];
    const push = (
      id: string,
      label: string,
      kind: string,
      slug: Parameters<typeof routes.admin.section>[0],
    ) => {
      results.push({
        id,
        label,
        hint: `${kind} · ${t(SECTION_META[slug ?? 'overview'].labelKey)}`,
        path: routes.admin.section(slug),
      });
    };

    for (const person of staff.data ?? []) {
      push(`staff-${person.id}`, person.name, STAFF_ROLE_LABEL[person.role], 'staff');
    }
    for (const dep of departments.data ?? []) {
      push(`dep-${dep.id}`, dep.name, 'Department', 'departments');
    }
    for (const room of rooms.data ?? []) {
      push(`room-${room.id}`, room.name, 'Room', 'rooms');
    }
    for (const res of resources.data ?? []) {
      push(`res-${res.id}`, res.name, res.category, 'resources');
    }
    for (const an of announcements.data ?? []) {
      push(`an-${an.id}`, an.title, 'Announcement', 'announcements');
    }
    for (const pol of policies.data ?? []) {
      push(`pol-${pol.id}`, pol.title, pol.category, 'policies');
    }
    for (const tpl of templates.data ?? []) {
      push(`tpl-${tpl.id}`, tpl.name, 'Template', 'templates');
    }
    for (const panel of SETTINGS_PANELS) {
      results.push({
        id: `set-${panel.id}`,
        label: panel.label,
        hint: `Settings · ${t(SECTION_META.settings.labelKey)}`,
        path: routes.admin.settings(panel.id),
      });
    }
    results.push({
      id: 'nav-preferences',
      label: 'My Settings',
      hint: `Account · ${t(SECTION_META.preferences.labelKey)}`,
      path: routes.admin.section('preferences'),
    });
    results.push({
      id: 'nav-profile',
      label: 'My Profile',
      hint: `Account · ${t(SECTION_META.profile.labelKey)}`,
      path: routes.admin.section('profile'),
    });
    return results;
  }, [
    t,
    staff.data,
    departments.data,
    rooms.data,
    resources.data,
    announcements.data,
    policies.data,
    templates.data,
  ]);

  const search = useCallback(
    (term: string): readonly ShellSearchResult[] => {
      const q = term.trim().toLowerCase();
      if (q.length === 0) return [];
      return index.filter(
        (r) => r.label.toLowerCase().includes(q) || r.hint.toLowerCase().includes(q),
      );
    },
    [index],
  );

  return useMemo(() => ({ search }), [search]);
}
