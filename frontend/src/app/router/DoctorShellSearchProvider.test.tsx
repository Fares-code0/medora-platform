import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useShellSearch, type ShellSearchResult, type ShellSearchValue } from '@/layouts';

import { DoctorShellSearchProvider } from './DoctorShellSearchProvider';

/**
 * NEW-21 — the doctor's search index arrives as code only once the field is
 * engaged. Before, this provider imported the index statically and so pulled
 * five features' services, adapters and demo data onto every doctor page,
 * though D-26 already kept it from fetching anything until engaged.
 *
 * The bridge module is replaced here by a stand-in whose factory records the
 * moment it is imported: that is the chunk the browser would download. The
 * module system imports it at most once per test file, so the first two
 * cases run in order and the third counts mounts rather than imports.
 */

const bridge = vi.hoisted(() => ({
  imported: 0,
  activations: 0,
  result: {
    id: 'pt',
    label: 'Khaled Nassar',
    hint: 'Patient',
    path: '/doctor/patients/PT-1001',
  } satisfies ShellSearchResult,
}));

vi.mock('./DoctorSearchIndexBridge', async () => {
  bridge.imported += 1;
  const { useEffect } = await import('react');
  return {
    default: function Stand({ onValue }: { onValue: (value: ShellSearchValue) => void }) {
      useEffect(() => {
        bridge.activations += 1;
        onValue({
          search: (term) => (term === '' ? [] : [bridge.result]),
          pending: false,
        });
      }, [onValue]);
      return null;
    },
  };
});

afterEach(() => {
  bridge.imported = 0;
  bridge.activations = 0;
});

let current: ShellSearchValue | null = null;
function Probe() {
  current = useShellSearch();
  return <output data-testid="pending">{String(current.pending ?? false)}</output>;
}

function renderProvider() {
  render(
    <DoctorShellSearchProvider>
      <Probe />
    </DoctorShellSearchProvider>,
  );
}

describe('DoctorShellSearchProvider', () => {
  it('downloads no index before the field is engaged, and claims nothing', async () => {
    renderProvider();
    // Give a stray eager import every chance to happen.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(bridge.imported).toBe(0);
    expect(current?.search('khaled')).toEqual([]);
    expect(screen.getByTestId('pending')).toHaveTextContent('false');
    expect(current?.onActivate).toBeTypeOf('function');
  });

  it('reports pending from the moment the field is engaged, then hands over to the index', async () => {
    renderProvider();

    act(() => current?.onActivate?.());

    // "Searching…", never "No matches", while the index is on its way.
    expect(screen.getByTestId('pending')).toHaveTextContent('true');
    await waitFor(() => expect(bridge.activations).toBe(1));
    expect(bridge.imported).toBe(1);
    await waitFor(() => expect(screen.getByTestId('pending')).toHaveTextContent('false'));
    expect(current?.search('khaled')).toEqual([bridge.result]);
  });

  it('mounts the index once however often the field is engaged', async () => {
    renderProvider();

    act(() => current?.onActivate?.());
    await waitFor(() => expect(bridge.activations).toBe(1));
    act(() => current?.onActivate?.());
    act(() => current?.onActivate?.());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(bridge.activations).toBe(1);
    expect(bridge.imported).toBeLessThanOrEqual(1);
  });
});
