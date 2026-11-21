import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import type { DashboardWidgetId } from '../model/widgets';

import { DashboardWidgetGrid } from './DashboardWidgetGrid';

/**
 * jsdom does no layout, so these pin the *mechanism* that makes the layout
 * hole-free rather than measuring pixels (the browser pass does that): a
 * wrapping flex row, every widget full-width below `md`, and from `md` a
 * preferred width plus a share of the leftover space — never a column span,
 * a fixed width, or an absolute position that would leave a gap behind.
 */
function renderGrid(ids: readonly DashboardWidgetId[]) {
  return render(
    <MemoryRouter>
      <DashboardWidgetGrid
        activeIds={ids}
        onRemove={vi.fn()}
        overview={{ data: undefined, loading: true, error: undefined }}
      />
    </MemoryRouter>,
  );
}

function items() {
  return within(screen.getByRole('list', { name: 'Dashboard widgets' }))
    .getAllByRole('listitem')
    .filter((item) => item.hasAttribute('data-widget-id'));
}

describe('DashboardWidgetGrid', () => {
  it('renders exactly the active widgets, in their order', () => {
    renderGrid(['appointments-trend', 'metric-pending-requests', 'notifications']);

    expect(items().map((item) => item.dataset['widgetId'])).toEqual([
      'appointments-trend',
      'metric-pending-requests',
      'notifications',
    ]);
  });

  it('wraps rows instead of placing widgets in fixed cells', () => {
    renderGrid(['notifications']);

    const list = screen.getByRole('list', { name: 'Dashboard widgets' });
    expect(list.className).toContain('flex-wrap');
    expect(list.className).not.toMatch(/\bgrid-cols-|\bgrid\b/);
  });

  it('stacks every widget below md and lets each grow into its row from md', () => {
    renderGrid(['metric-active-patients', 'practice-pulse', 'todays-schedule']);

    for (const item of items()) {
      expect(item.className).toContain('basis-full');
      expect(item.className).toContain('grow');
      expect(item.className).toMatch(/md:basis-/);
      expect(item.className).not.toMatch(/col-span|row-span|absolute|\bw-\[/);
    }
  });

  it('asks for more room the larger the widget', () => {
    renderGrid(['metric-active-patients', 'practice-pulse', 'todays-schedule']);

    const [compact, standard, wide] = items();
    expect(compact?.dataset['widgetSize']).toBe('compact');
    expect(standard?.dataset['widgetSize']).toBe('standard');
    expect(wide?.dataset['widgetSize']).toBe('wide');
    expect(compact?.className).toContain('md:basis-56');
    expect(standard?.className).toContain('md:basis-80');
    expect(wide?.className).toContain('md:basis-[32rem]');
  });
});
