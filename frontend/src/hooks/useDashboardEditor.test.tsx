import type { ReactNode } from 'react';

import { act, renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { AppProviders } from '@/app/providers';

import { useDashboardEditor } from './useDashboardEditor';
import type { DashboardWidgetSelection } from './useDashboardWidgetSelection';

type Id = 'a' | 'b' | 'c';

/** A saved selection whose `replace` is observable and never touches storage. */
function savedSelection(ids: readonly Id[], saves = true): DashboardWidgetSelection<Id> {
  return {
    activeIds: ids,
    isActive: (id) => ids.includes(id),
    add: vi.fn(),
    remove: vi.fn(),
    restore: vi.fn(),
    clear: vi.fn(),
    replace: vi.fn(() => saves),
  };
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter>
      <AppProviders>{children}</AppProviders>
    </MemoryRouter>
  );
}

function renderEditor(selection: DashboardWidgetSelection<Id>) {
  return renderHook(() => useDashboardEditor(selection, (id) => id.toUpperCase()), { wrapper });
}

describe('useDashboardEditor · draft and commit', () => {
  it('copies the saved selection into the draft by value, not by reference', () => {
    const saved: Id[] = ['a'];
    const selection = savedSelection(saved);
    const { result } = renderEditor(selection);

    act(() => result.current.openCustomize());
    act(() => result.current.toggle('b', true));

    expect(result.current.isDraftActive('b')).toBe(true);
    // The saved array was not mutated, and nothing was committed.
    expect(saved).toEqual(['a']);
    expect(selection.replace).not.toHaveBeenCalled();
    expect(selection.add).not.toHaveBeenCalled();
    expect(selection.remove).not.toHaveBeenCalled();
    expect(selection.clear).not.toHaveBeenCalled();
  });

  it('commits exactly once however many times Done fires', () => {
    const selection = savedSelection(['a']);
    const { result } = renderEditor(selection);

    act(() => result.current.openCustomize());
    act(() => result.current.toggle('c', true));
    const done = result.current.commitCustomize;
    act(() => {
      done();
      done();
    });
    act(() => result.current.commitCustomize());

    expect(selection.replace).toHaveBeenCalledTimes(1);
    expect(selection.replace).toHaveBeenCalledWith(['a', 'c']);
    expect(result.current.customizing).toBe(false);
  });

  it('cancel commits nothing, and the next open starts from the saved selection', () => {
    const selection = savedSelection(['a', 'b']);
    const { result } = renderEditor(selection);

    act(() => result.current.openCustomize());
    act(() => result.current.toggle('a', false));
    act(() => result.current.clearDraft());
    act(() => result.current.cancelCustomize());

    expect(result.current.customizing).toBe(false);
    expect(selection.replace).not.toHaveBeenCalled();

    act(() => result.current.openCustomize());
    expect(result.current.isDraftActive('a')).toBe(true);
    expect(result.current.isDraftActive('b')).toBe(true);
    expect(result.current.draftCount).toBe(2);
  });

  it('ignores drawer edits when no draft is open', () => {
    const selection = savedSelection(['a']);
    const { result } = renderEditor(selection);

    act(() => result.current.toggle('b', true));
    act(() => result.current.commitCustomize());

    expect(result.current.customizing).toBe(false);
    expect(selection.replace).not.toHaveBeenCalled();
  });
});
