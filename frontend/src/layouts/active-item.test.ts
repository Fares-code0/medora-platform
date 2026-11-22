import { describe, expect, it } from 'vitest';

import { isItemActive } from './active-item';
import { adminNavigation, doctorNavigation } from './navigation';

/**
 * Which nav item is highlighted. A plain `pathname.startsWith(item.path)`
 * breaks as soon as one item's path is a prefix of another's: the admin
 * area's overview lives at `/admin`, which prefixes every other admin route,
 * so two items lit up at once. The most specific match wins instead.
 */

const adminItems = adminNavigation.sections.flatMap((s) => s.items);
const doctorItems = doctorNavigation.sections.flatMap((s) => s.items);
const adminPaths = adminItems.map((i) => i.path);
const doctorPaths = doctorItems.map((i) => i.path);

/** Exactly the items the real sidebar would highlight for a pathname. */
function activeFor(items: readonly { path: string; end?: boolean }[], pathname: string): string[] {
  const paths = items.map((i) => i.path);
  return items
    .filter((item) => isItemActive(pathname, item.path, paths, item.end))
    .map((item) => item.path);
}

describe('isItemActive', () => {
  it('highlights exactly one admin item on the area root', () => {
    expect(activeFor(adminItems, '/admin')).toEqual(['/admin']);
  });

  it('does not leave the area root highlighted on a sibling section', () => {
    expect(activeFor(adminItems, '/admin/clinic')).toEqual(['/admin/clinic']);
    expect(activeFor(adminItems, '/admin/staff')).toEqual(['/admin/staff']);
    expect(activeFor(adminItems, '/admin/rooms')).toEqual(['/admin/rooms']);
  });

  it('lights nothing on the admin Waiting Room page, which left the admin sidebar', () => {
    // Still reachable by URL; its sidebar entry is reception's now, and the
    // admin root must not claim the page instead.
    expect(activeFor(adminItems, '/admin/waiting-room')).toEqual([]);
    expect(activeFor(adminItems, '/admin/queue')).toEqual([]);
  });

  it('keeps a list item highlighted on its own detail route', () => {
    expect(activeFor(doctorItems, '/doctor/patients/PT-1001')).toEqual(['/doctor/patients']);
  });

  it('highlights exactly one doctor item per route', () => {
    for (const pathname of doctorPaths) {
      expect(activeFor(doctorItems, pathname), `ambiguous for ${pathname}`).toHaveLength(1);
    }
  });

  it('highlights exactly one admin item per route', () => {
    for (const pathname of adminPaths) {
      expect(activeFor(adminItems, pathname), `ambiguous for ${pathname}`).toHaveLength(1);
    }
  });

  it('highlights nothing for a route outside the menu', () => {
    expect(activeFor(adminItems, '/admin/settings/security')).toEqual([]);
    expect(activeFor(doctorItems, '/doctor/settings/profile')).toEqual([]);
  });

  it('does not treat a shared prefix as a match', () => {
    // "/admin/staff" must not light up for "/admin/staffing".
    expect(isItemActive('/admin/staffing', '/admin/staff', adminPaths)).toBe(false);
  });
});

describe('isItemActive — Patients and Labs groups', () => {
  const patientPaths = ['/doctor/patients', '/doctor/patients/new'];
  const labPaths = ['/doctor/labs', '/doctor/labs/new'];

  it('marks Add Patient, not the list, on the registration page', () => {
    expect(isItemActive('/doctor/patients/new', '/doctor/patients/new', patientPaths)).toBe(true);
    expect(isItemActive('/doctor/patients/new', '/doctor/patients', patientPaths)).toBe(false);
  });

  it('keeps the list active on a patient profile', () => {
    expect(isItemActive('/doctor/patients/PT-1', '/doctor/patients', patientPaths)).toBe(true);
    expect(isItemActive('/doctor/patients/PT-1', '/doctor/patients/new', patientPaths)).toBe(false);
  });

  it('marks New Order on the order page and the list on a result', () => {
    expect(isItemActive('/doctor/labs/new', '/doctor/labs/new', labPaths)).toBe(true);
    expect(isItemActive('/doctor/labs/new', '/doctor/labs', labPaths)).toBe(false);
    expect(isItemActive('/doctor/labs/LR-1', '/doctor/labs', labPaths)).toBe(true);
  });
});
