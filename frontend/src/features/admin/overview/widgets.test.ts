import { describe, expect, it } from 'vitest';

import { ADMIN_WIDGET_GROUPS, ADMIN_WIDGET_IDS, ADMIN_WIDGETS, getAdminWidget } from './widgets';

/**
 * The catalogue is the Admin dashboard's single source of truth, so its
 * integrity is what these pin: one entry per id, a known group for each, and
 * titles unique enough to name a switch and a ⋯ menu. That each widget
 * renders its title and menu is `AdminOverviewDashboard.test.tsx`'s.
 */
describe('admin widget catalogue', () => {
  it('has exactly one entry per id, in id order', () => {
    expect(ADMIN_WIDGETS.map((widget) => widget.id)).toEqual([...ADMIN_WIDGET_IDS]);
  });

  it('puts every widget in a group the drawer renders, and leaves no group empty', () => {
    const groups = new Set<string>(ADMIN_WIDGET_GROUPS.map((group) => group.id));
    for (const widget of ADMIN_WIDGETS) expect(groups.has(widget.group)).toBe(true);
    for (const group of ADMIN_WIDGET_GROUPS) {
      expect(ADMIN_WIDGETS.some((widget) => widget.group === group.id)).toBe(true);
    }
  });

  it('has a unique title for every widget', () => {
    const titles = ADMIN_WIDGETS.map((widget) => widget.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it('finds every id it ships', () => {
    for (const id of ADMIN_WIDGET_IDS) expect(getAdminWidget(id).id).toBe(id);
  });
});
