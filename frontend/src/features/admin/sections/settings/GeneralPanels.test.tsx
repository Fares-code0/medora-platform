import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminSettingsDocument } from '../../admin-settings.types';
import { adminSettingsApi } from '../../api/admin-settings.api';
import { useAdminSettings } from '../../api/useAdminSettingsQueries';

import { GeneralPanel } from './GeneralPanels';

/**
 * GeneralPanel — testing the default landing section resolution (ADM-01).
 *
 * The panel displays `defaultSection` after resolving stale slugs, but the
 * draft sent to SettingsPanelForm must also have the resolved value so that
 * the form captures it correctly. This test verifies that a document with a
 * stored `defaultSection` of `'platform'` (which no longer exists) produces
 * a draft value of `'overview'` (the resolved replacement) — proven by
 * routing through the actual persistence layer.
 *
 * `SettingsPanelForm` seeds its draft from the `value` prop it is handed and
 * compares the two with `JSON.stringify`, so if resolution ever happened,
 * both sides of that comparison already carry the resolved slug — dirtiness
 * can't tell resolved from unresolved apart. The `<Select>` can't tell them
 * apart either: its own `value` is independently re-resolved on every render
 * (see the other `resolveLandingSection` call in `GeneralPanels.tsx`), so it
 * would read "Overview" regardless of what the draft actually holds.
 *
 * The only place the two paths diverge is the payload the form would submit
 * for a field the user never touched. So the test below edits an unrelated
 * field (dirtying the form without touching `defaultSection`), saves, and
 * reads back what `adminSettingsApi` actually persisted. If `defaultSection`
 * were resolved only for display, the persisted document would keep the
 * stale `'platform'` slug; only resolving it in the `value` prop makes the
 * saved document carry `'overview'`.
 */

vi.mock('@/app/providers', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Marcus Reed', email: 'admin@medora.health' } }),
  useCan: () => () => true,
  useToast: () => ({ toast: () => undefined }),
}));

beforeAll(() => {
  const proto = window.HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  proto['showModal'] = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  proto['close'] = function close(this: HTMLDialogElement) {
    this.open = false;
  };

  vi.stubGlobal(
    'Request',
    class {
      readonly url: string;
      readonly signal: AbortSignal | undefined;
      constructor(url: string, init?: { signal?: AbortSignal }) {
        this.url = url;
        this.signal = init?.signal;
      }
    },
  );
});

beforeEach(() => {
  window.localStorage.clear();
});

function LoadedPanel() {
  const query = useAdminSettings();
  if (!query.data) return <p>loading…</p>;
  return <GeneralPanel document={query.data} />;
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const router = createMemoryRouter(
    [
      {
        path: '/admin/settings/general',
        element: <LoadedPanel />,
      },
    ],
    { initialEntries: ['/admin/settings/general'] },
  );

  function Tree({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }

  return render(
    <Tree>
      <RouterProvider router={router} />
    </Tree>,
  );
}

describe('GeneralPanel', () => {
  describe('default landing section resolution', () => {
    it('saves a resolved defaultSection even when only an unrelated field changes', async () => {
      const user = userEvent.setup();

      // Seed the settings with a stale 'platform' slug (ADM-01 retired it
      // but existing documents may still have it). The cast is required
      // because the type union no longer permits 'platform' — that's the
      // whole point: this simulates a document persisted before ADM-01
      // narrowed the union, which the real union can no longer express.
      const current = await adminSettingsApi.getSettings();
      const stalePlatformSettings: AdminSettingsDocument = {
        ...current,
        general: {
          ...current.general,
          defaultSection: 'platform' as AdminSettingsDocument['general']['defaultSection'],
        },
      };
      await adminSettingsApi.saveSection('general', stalePlatformSettings.general);

      renderPanel();

      // Wait for the panel to load by finding the default landing section select.
      await screen.findByRole('combobox', { name: /Default landing section/ });

      // Dirty the form through a field that has nothing to do with
      // defaultSection, so the select is never interacted with and its
      // own (independent) display-time resolution can't mask the bug.
      const platformName = await screen.findByRole('textbox', { name: /Platform name/ });
      await user.clear(platformName);
      await user.type(platformName, 'Riverside Health Platform');

      const saveButton = await screen.findByRole('button', { name: /Save changes/ });
      await user.click(saveButton);

      // Once the save completes the form resyncs to the persisted value and
      // the Save button disappears — wait for that before reading back what
      // was actually written.
      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /Save changes/ })).not.toBeInTheDocument();
      });

      const saved = await adminSettingsApi.getSettings();
      expect(saved.general.defaultSection).toBe('overview');
    });
  });
});
