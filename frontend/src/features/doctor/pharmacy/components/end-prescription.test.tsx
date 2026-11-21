import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '@/app/providers';

import { usePrescriptionQuery, usePrescriptionsQuery } from '../api/usePrescriptionsQuery';
import { usePrescriptionLifecycle } from '../hooks/usePrescriptionLifecycle';
import { __putMockPrescription, __resetPharmacyStore } from '../mock/mock-prescription-service';
import { MOCK_PRESCRIPTIONS } from '../model/mock-data';
import { endActFor, type EndAct } from '../model/selectors';
import type { Prescription, PrescriptionStatus } from '../model/types';
import { prescriptionService } from '../service';

import { PrescriptionQuickActions } from './detail/PrescriptionQuickActions';
import { DiscardPrescriptionDraftDialog } from './DiscardPrescriptionDraftDialog';
import { EndPrescriptionDialog } from './EndPrescriptionDialog';
import { PrescriptionRowActions } from './PrescriptionRowActions';

/**
 * Ending a prescription (DEC-002): the status decides the act, both menus
 * agree, the dialog names the act, a reason is required, and the act decides
 * the endpoint. A draft offers neither — the server refuses both — and offers
 * Discard instead (BR-DEC-002), confirmed and pessimistic.
 */

beforeAll(() => {
  const proto = window.HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  proto['showModal'] = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  proto['close'] = function close(this: HTMLDialogElement) {
    this.open = false;
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  __resetPharmacyStore();
  window.localStorage.clear();
});

const BASE: Prescription = (() => {
  const first = MOCK_PRESCRIPTIONS[0];
  if (first === undefined) throw new Error('no mock prescription');
  return first;
})();

function inStatus(status: PrescriptionStatus): Prescription {
  return { ...BASE, id: `RX-${status}`, status };
}

const CANCEL = 'Cancel prescription';
const DISCONTINUE = 'Discontinue';
const DISCARD = 'Discard draft';

describe('endActFor', () => {
  it.each([
    ['pending-approval', 'cancel'],
    ['active', 'discontinue'],
    ['dispensed', 'discontinue'],
    ['draft', null],
    ['completed', null],
    ['discontinued', null],
    ['expired', null],
  ] as const)('%s → %s', (status, act) => {
    expect(endActFor(inStatus(status))).toBe(act);
  });
});

function Harness({
  prescription,
  surface,
}: {
  prescription: Prescription;
  surface: 'row' | 'detail';
}) {
  const lifecycle = usePrescriptionLifecycle();
  return (
    <>
      {surface === 'row' ? (
        <PrescriptionRowActions
          prescription={prescription}
          onOpen={vi.fn()}
          onRenew={lifecycle.onRenew}
          onEnd={lifecycle.openEnd}
        />
      ) : (
        <PrescriptionQuickActions
          prescription={prescription}
          onRenew={lifecycle.onRenew}
          onEnd={lifecycle.openEnd}
        />
      )}
      {lifecycle.ending === null ? null : (
        <EndPrescriptionDialog
          open
          act={lifecycle.ending.act}
          prescriptionId={lifecycle.ending.prescription.id}
          medicationLabel={lifecycle.ending.prescription.medication.name}
          loading={lifecycle.endPending}
          onConfirm={lifecycle.onConfirmEnd}
          onClose={lifecycle.closeEnd}
        />
      )}
      {lifecycle.discarding === null ? null : (
        <DiscardPrescriptionDraftDialog
          prescriptionId={lifecycle.discarding.id}
          medicationLabel={lifecycle.discarding.medication.name}
          loading={lifecycle.discardPending}
          onConfirm={lifecycle.onConfirmDiscard}
          onClose={lifecycle.closeDiscard}
        />
      )}
    </>
  );
}

function renderSurface(prescription: Prescription, surface: 'row' | 'detail') {
  return render(
    <MemoryRouter>
      <AppProviders>
        <Harness prescription={prescription} surface={surface} />
      </AppProviders>
    </MemoryRouter>,
  );
}

async function openMenu(surface: 'row' | 'detail', id: string) {
  const user = userEvent.setup();
  await user.click(
    screen.getByRole('button', {
      name: surface === 'row' ? `More actions for ${id}` : 'More prescription actions',
    }),
  );
  return { user, menu: await screen.findByRole('menu') };
}

describe.each(['row', 'detail'] as const)('the %s menu', (surface) => {
  it('offers only "Cancel prescription" while awaiting approval', async () => {
    const prescription = inStatus('pending-approval');
    renderSurface(prescription, surface);
    const { menu } = await openMenu(surface, prescription.id);

    expect(within(menu).getByRole('menuitem', { name: CANCEL })).toBeEnabled();
    expect(within(menu).queryByRole('menuitem', { name: DISCONTINUE })).not.toBeInTheDocument();
  });

  it.each(['active', 'dispensed'] as const)('offers only "Discontinue" when %s', async (status) => {
    const prescription = inStatus(status);
    renderSurface(prescription, surface);
    const { menu } = await openMenu(surface, prescription.id);

    expect(within(menu).getByRole('menuitem', { name: DISCONTINUE })).toBeEnabled();
    expect(within(menu).queryByRole('menuitem', { name: CANCEL })).not.toBeInTheDocument();
  });

  it('offers neither for an unsigned draft, but Discard (BR-DEC-002)', async () => {
    const prescription = inStatus('draft');
    renderSurface(prescription, surface);
    const { menu } = await openMenu(surface, prescription.id);

    expect(within(menu).queryByRole('menuitem', { name: CANCEL })).not.toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: DISCONTINUE })).not.toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: DISCARD })).toBeEnabled();
  });

  it.each(['pending-approval', 'active', 'dispensed'] as const)(
    'offers no Discard once signed (%s)',
    async (status) => {
      const prescription = inStatus(status);
      renderSurface(prescription, surface);
      const { menu } = await openMenu(surface, prescription.id);

      expect(within(menu).queryByRole('menuitem', { name: DISCARD })).not.toBeInTheDocument();
    },
  );

  it('offers nothing to end once it has ended', async () => {
    const prescription = inStatus('completed');
    renderSurface(prescription, surface);
    const { menu } = await openMenu(surface, prescription.id);

    for (const name of [CANCEL, DISCONTINUE, DISCARD]) {
      expect(within(menu).queryByRole('menuitem', { name })).not.toBeInTheDocument();
    }
  });
});

describe('discarding an unsigned draft — BR-DEC-002', () => {
  it('confirms first, discards only the draft, and never cancels or discontinues', async () => {
    const draft = inStatus('draft');
    __putMockPrescription(draft);
    const discard = vi.spyOn(prescriptionService, 'discardPrescriptionDraft');
    const cancel = vi.spyOn(prescriptionService, 'cancel');
    const discontinue = vi.spyOn(prescriptionService, 'discontinue');
    renderSurface(draft, 'row');
    const { user, menu } = await openMenu('row', draft.id);

    await user.click(within(menu).getByRole('menuitem', { name: DISCARD }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Discard this draft?' });
    expect(within(dialog).getByText(/never signed and dispenses nothing/)).toBeInTheDocument();
    expect(within(dialog).getByText(/It is not erased/)).toBeInTheDocument();
    expect(discard).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Discard draft' }));

    expect(await screen.findByText(`${draft.id} discarded`)).toBeInTheDocument();
    expect(discard).toHaveBeenCalledWith(draft.id);
    expect(cancel).not.toHaveBeenCalled();
    expect(discontinue).not.toHaveBeenCalled();
    await expect(prescriptionService.getPrescription(draft.id)).rejects.toThrow();
  });

  it('names a refusal and keeps the dialog when the draft was signed meanwhile', async () => {
    const draft = inStatus('draft');
    vi.spyOn(prescriptionService, 'discardPrescriptionDraft').mockRejectedValue(
      new Error('PRESCRIPTION_NOT_DRAFT'),
    );
    renderSurface(draft, 'detail');
    const { user, menu } = await openMenu('detail', draft.id);

    await user.click(within(menu).getByRole('menuitem', { name: DISCARD }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Discard this draft?' });
    await user.click(within(dialog).getByRole('button', { name: 'Discard draft' }));

    expect(await screen.findByText('Could not discard the draft')).toBeInTheDocument();
    expect(screen.getByText(/no longer an unsigned draft/)).toBeInTheDocument();
    expect(screen.getByRole('alertdialog', { name: 'Discard this draft?' })).toBeInTheDocument();
  });
});

describe('confirming', () => {
  it('cancels a pending prescription through /cancel, with the withdrawal wording and a required reason', async () => {
    const prescription = inStatus('pending-approval');
    const cancel = vi
      .spyOn(prescriptionService, 'cancel')
      .mockResolvedValue({ ...prescription, status: 'discontinued' });
    const discontinue = vi.spyOn(prescriptionService, 'discontinue');
    renderSurface(prescription, 'row');
    const { user, menu } = await openMenu('row', prescription.id);
    await user.click(within(menu).getByRole('menuitem', { name: CANCEL }));

    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(`Cancel ${prescription.id}`)).toBeInTheDocument();
    expect(within(dialog).getByText(/has not taken effect yet/)).toBeInTheDocument();
    expect(within(dialog).getByText(/withdraws it before therapy starts/)).toBeInTheDocument();
    const confirm = within(dialog).getByRole('button', { name: CANCEL });
    expect(confirm).toBeDisabled();

    await user.click(within(dialog).getByRole('combobox', { name: /Reason/ }));
    await user.click(screen.getByRole('option', { name: 'Prescribed in error' }));
    await user.click(confirm);

    await waitFor(() => {
      expect(cancel).toHaveBeenCalledTimes(1);
    });
    expect(cancel.mock.calls[0]?.[0]).toMatchObject({
      prescriptionId: prescription.id,
      reason: 'Prescribed in error',
    });
    expect(discontinue).not.toHaveBeenCalled();
  });

  it.each(['active', 'dispensed'] as const)(
    'discontinues a %s prescription through /discontinue, with the stop-therapy wording',
    async (status) => {
      const prescription = inStatus(status);
      const discontinue = vi
        .spyOn(prescriptionService, 'discontinue')
        .mockResolvedValue({ ...prescription, status: 'discontinued' });
      const cancel = vi.spyOn(prescriptionService, 'cancel');
      renderSurface(prescription, 'detail');
      const { user, menu } = await openMenu('detail', prescription.id);
      await user.click(within(menu).getByRole('menuitem', { name: DISCONTINUE }));

      const dialog = await screen.findByRole('alertdialog');
      expect(within(dialog).getByText(`Discontinue ${prescription.id}`)).toBeInTheDocument();
      expect(within(dialog).getByText(/stops the active therapy/)).toBeInTheDocument();
      const confirm = within(dialog).getByRole('button', { name: DISCONTINUE });
      expect(confirm).toBeDisabled();

      await user.click(within(dialog).getByRole('combobox', { name: /Reason/ }));
      await user.click(screen.getByRole('option', { name: 'Adverse reaction' }));
      await user.click(confirm);

      await waitFor(() => {
        expect(discontinue).toHaveBeenCalledTimes(1);
      });
      expect(discontinue.mock.calls[0]?.[0]).toMatchObject({
        prescriptionId: prescription.id,
        reason: 'Adverse reaction',
      });
      expect(cancel).not.toHaveBeenCalled();
    },
  );
});

/**
 * The status is the server's, never a guess. The harness draws the row from
 * the list query and the detail from the detail query — what the pharmacy
 * table and the detail page read — over a fake server whose answer to the
 * end request the test holds back, refuses or grants.
 */
describe('ending is pessimistic', () => {
  function LiveHarness({ id }: { id: string }) {
    const lifecycle = usePrescriptionLifecycle();
    const row = usePrescriptionsQuery().data?.find((p) => p.id === id);
    const detail = usePrescriptionQuery(id).data;
    if (row === undefined || detail === undefined) return <p>Loading</p>;
    return (
      <>
        <p data-testid="row-status">{row.status}</p>
        <p data-testid="detail-status">{detail.status}</p>
        <PrescriptionRowActions
          prescription={row}
          onOpen={vi.fn()}
          onRenew={lifecycle.onRenew}
          onEnd={lifecycle.openEnd}
        />
        {lifecycle.ending === null ? null : (
          <EndPrescriptionDialog
            open
            act={lifecycle.ending.act}
            prescriptionId={lifecycle.ending.prescription.id}
            medicationLabel={lifecycle.ending.prescription.medication.name}
            loading={lifecycle.endPending}
            onConfirm={lifecycle.onConfirmEnd}
            onClose={lifecycle.closeEnd}
          />
        )}
      </>
    );
  }

  const CASES = [
    { act: 'cancel', status: 'pending-approval', item: CANCEL, done: 'cancelled' },
    { act: 'discontinue', status: 'active', item: DISCONTINUE, done: 'discontinued' },
  ] as const satisfies readonly {
    act: EndAct;
    status: PrescriptionStatus;
    item: string;
    done: string;
  }[];

  /** A fake server holding one prescription, whose end request the test settles by hand. */
  function serve(status: PrescriptionStatus, act: EndAct) {
    let held = inStatus(status);
    vi.spyOn(prescriptionService, 'listPrescriptions').mockImplementation(() =>
      Promise.resolve([held]),
    );
    vi.spyOn(prescriptionService, 'getPrescription').mockImplementation(() =>
      Promise.resolve(held),
    );
    let settle: { grant: () => void; refuse: () => void } | undefined;
    const endpoint = vi.spyOn(prescriptionService, act).mockImplementation(
      () =>
        new Promise<Prescription>((resolve, reject) => {
          settle = {
            grant: () => {
              held = { ...held, status: 'discontinued', refillStatus: 'none', refillsRemaining: 0 };
              resolve(held);
            },
            refuse: () => {
              reject(new Error('server refused'));
            },
          };
        }),
    );
    const other = vi.spyOn(prescriptionService, act === 'cancel' ? 'discontinue' : 'cancel');
    return {
      endpoint,
      other,
      settle: () => {
        if (settle === undefined) throw new Error('no end request in flight');
        return settle;
      },
    };
  }

  async function confirmEnd(item: string, id: string) {
    renderLive(id);
    await screen.findByTestId('row-status');
    const { user, menu } = await openMenu('row', id);
    await user.click(within(menu).getByRole('menuitem', { name: item }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('combobox', { name: /Reason/ }));
    await user.click(screen.getByRole('option', { name: 'Prescribed in error' }));
    await user.click(within(dialog).getByRole('button', { name: item }));
    return dialog;
  }

  function renderLive(id: string) {
    return render(
      <MemoryRouter>
        <AppProviders>
          <LiveHarness id={id} />
        </AppProviders>
      </MemoryRouter>,
    );
  }

  function expectStatus(status: PrescriptionStatus) {
    expect(screen.getByTestId('row-status')).toHaveTextContent(status);
    expect(screen.getByTestId('detail-status')).toHaveTextContent(status);
  }

  it.each(CASES)(
    '$act: the status does not change while the request is in flight',
    async ({ act, status, item }) => {
      const server = serve(status, act);
      await confirmEnd(item, `RX-${status}`);

      await waitFor(() => {
        expect(server.endpoint).toHaveBeenCalledTimes(1);
      });
      expect(server.endpoint.mock.calls[0]?.[0]).toMatchObject({
        prescriptionId: `RX-${status}`,
        reason: 'Prescribed in error',
      });
      expect(server.other).not.toHaveBeenCalled();
      expectStatus(status);
      expect(screen.queryByText('discontinued')).not.toBeInTheDocument();
    },
  );

  it.each(CASES)(
    '$act: a server refusal leaves the prescription as it was and says so',
    async ({ act, status, item }) => {
      const server = serve(status, act);
      const dialog = await confirmEnd(item, `RX-${status}`);
      await waitFor(() => {
        expect(server.endpoint).toHaveBeenCalledTimes(1);
      });

      server.settle().refuse();

      expect(await screen.findByText(`Could not ${act} the prescription`)).toBeInTheDocument();
      expect(screen.getByText('It is unchanged. Please try again.')).toBeInTheDocument();
      expectStatus(status);
      // The dialog stays open with the reason kept, so the doctor can retry.
      expect(dialog).toBeInTheDocument();
      expect(within(dialog).getByRole('button', { name: item })).toBeEnabled();
      // The refetch after the failure still finds it unchanged on the server.
      await waitFor(() => {
        expectStatus(status);
      });
    },
  );

  it.each(CASES)(
    '$act: the status changes once the server has ended it',
    async ({ act, status, item, done }) => {
      const server = serve(status, act);
      await confirmEnd(item, `RX-${status}`);
      await waitFor(() => {
        expect(server.endpoint).toHaveBeenCalledTimes(1);
      });
      expectStatus(status);

      server.settle().grant();

      expect(await screen.findByText(`RX-${status} ${done}`)).toBeInTheDocument();
      await waitFor(() => {
        expectStatus('discontinued');
      });
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    },
  );
});
