import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { AppProviders } from '@/app/providers';
import type * as Providers from '@/app/providers';
import { DEFAULT_PERMISSION_MATRIX } from '@/features/admin/permissions';
import { PhiAccessProvider } from '@/features/admin/phi';
import type { SessionUser } from '@/types/auth';

import { WaitingRoomSection } from './WaitingRoomSection';

const LOAD = { timeout: 10_000 };

// The row's write controls (Call, Seat in room, Check out) are shown to an
// administrator only — reception reads the board — and these layout cases
// are about a row carrying them, so the section is rendered as one. The
// pattern `write-confirmation.test.tsx` uses; the other providers are real.
function adminUser(): SessionUser {
  return {
    id: 'usr_admin_test',
    name: 'Test Administrator',
    email: 'admin@medora.health',
    role: 'admin',
    permissions: DEFAULT_PERMISSION_MATRIX.admin,
  };
}

vi.mock('@/app/providers', async (importOriginal) => {
  const actual: typeof Providers = await importOriginal();
  return {
    ...actual,
    useAuth: () => ({ ...actual.useAuth(), user: adminUser() }),
  };
});

function renderSection() {
  return render(
    <MemoryRouter initialEntries={['/admin/waiting-room']}>
      <AppProviders>
        <PhiAccessProvider>
          <Routes>
            <Route path="/admin/waiting-room" element={<WaitingRoomSection />} />
          </Routes>
        </PhiAccessProvider>
      </AppProviders>
    </MemoryRouter>,
  );
}

describe('WaitingRoomSection — phone width', () => {
  /*
   * Each card sits in a grid track. A grid item will not shrink below its
   * min-content width, and a single-line row's min-content is the name, the
   * wait, the status badge and the actions side by side — about 400px. At a
   * 390px viewport that pushed the card past the screen edge and the Check out
   * button out of view (visual QA, 2026-11-12). The row has to be allowed to
   * wrap. jsdom does no layout, so the contract is asserted on the class.
   */
  it('lets each patient row wrap, so Check out never leaves the screen', async () => {
    renderSection();

    const checkOuts = await screen.findAllByRole('button', { name: /^Check out / }, LOAD);
    expect(checkOuts.length).toBeGreaterThan(0);
    for (const button of checkOuts) {
      const row = button.closest('li');
      expect(row, 'a Check out button outside a patient row').not.toBeNull();
      expect(row!.className.split(/\s+/)).toContain('flex-wrap');
    }
  });

  /*
   * Wrapping alone is not enough: the name block is `flex-1` (basis 0) and
   * `min-w-0`, so it shrinks to a sliver — the name cut to two letters and the
   * appointment details one word per line — before anything wraps. A basis
   * makes the status and actions wrap below the name instead.
   */
  it('keeps the patient block wide enough to read before the row wraps', async () => {
    renderSection();

    const [button] = await screen.findAllByRole('button', { name: /^Check out / }, LOAD);
    const nameBlock = button!.closest('li')!.firstElementChild as HTMLElement;
    expect(nameBlock.className.split(/\s+/)).toContain('flex-1');
    expect(nameBlock.className).toMatch(/(^|\s)basis-\d+(\s|$)/);
  });
});
