import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '@/app/providers';
import { RequireAuth } from '@/app/router/guards';
import { __resetRecordAttachments } from '@/features/shared-domain/record-attachments';

import { __resetLabsStore } from '../mock/mock-lab-service';
import { criticalUnreviewedCount, inboxTests, partitionForBulkReview } from '../model/review';
import { labService } from '../service';

import { LabsPage } from './LabsPage';

/**
 * The Inbox and the review loop in the DOM (D-10, D-11, D-12).
 *
 * The load-bearing tests are the two negatives:
 *
 * - a critical result cannot be confirmed until every value is ticked AND a
 *   note is written — and "cannot" is asserted by clicking the button and
 *   observing that nothing was written, not by reading a `disabled`
 *   attribute, because `disabled` is the property this design does not rely
 *   on;
 * - a failed write leaves the row in the Inbox and says so, rather than
 *   optimistically clearing it.
 */

const LOAD = { timeout: 10_000 };
/** Each case waits on the 400ms mock latency several times over. */
const CASE_TIMEOUT = 20_000;

/*
 * Same stub the admin communications suite uses: the review and
 * attach dialogs render through the design system's `Modal`, a native
 * <dialog> jsdom has the element for but not the imperative methods on.
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

function renderList(search = '') {
  return render(
    <MemoryRouter initialEntries={[`/doctor/labs${search}`]}>
      <AppProviders>
        <Routes>
          <Route path="/doctor/labs" element={<LabsPage />} />
          <Route path="/doctor/labs/:labId" element={<h1>Lab detail</h1>} />
        </Routes>
      </AppProviders>
    </MemoryRouter>,
  );
}

/** The table is md+; jsdom's matchMedia stub reports false, so cards render. */
async function waitForRows() {
  await screen.findByRole('tab', { name: /Inbox/ }, LOAD);
  await waitFor(
    () => {
      expect(screen.queryByText(/Loading|aria-busy/i)).not.toBeInTheDocument();
    },
    LOAD,
  );
}

beforeEach(() => {
  __resetLabsStore();
  __resetRecordAttachments();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('the two tabs (D-10)', () => {
  it('opens on the Inbox, whose count is the number of results awaiting review', async () => {
    renderList();
    const inbox = await screen.findByRole('tab', { name: /Inbox/ }, LOAD);

    const all = await labService.listLabTests();
    expect(inbox).toHaveAttribute('aria-selected', 'true');
    await waitFor(
      () => {
        expect(inbox).toHaveTextContent(String(inboxTests(all).length));
      },
      LOAD,
    );
  }, CASE_TIMEOUT);

  it('shows every result on All results, including the reviewed ones', async () => {
    const user = userEvent.setup();
    renderList();
    await waitForRows();

    const all = await labService.listLabTests();
    await user.click(screen.getByRole('tab', { name: /All results/ }));

    const tab = screen.getByRole('tab', { name: /All results/ });
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(tab).toHaveTextContent(String(all.length));
  }, CASE_TIMEOUT);

  it('lands a patient deep link on All results — a patient with nothing outstanding is not empty', async () => {
    renderList('?patient=PT-1004');
    const all = await screen.findByRole('tab', { name: /All results/ }, LOAD);
    expect(all).toHaveAttribute('aria-selected', 'true');
  }, CASE_TIMEOUT);

  it('an explicit tab wins over the deep-link default', async () => {
    renderList('?patient=PT-1004&tab=inbox');
    const inbox = await screen.findByRole('tab', { name: /Inbox/ }, LOAD);
    expect(inbox).toHaveAttribute('aria-selected', 'true');
  }, CASE_TIMEOUT);
});

describe('the critical-unreviewed chip (D-12)', () => {
  it('pins the count of unreviewed critical results above the tabs', async () => {
    renderList();
    const all = await labService.listLabTests();
    const expected = criticalUnreviewedCount(all);
    expect(expected).toBeGreaterThan(0);

    await waitFor(
      () => {
        expect(screen.getByText(`Critical unreviewed: ${String(expected)}`)).toBeInTheDocument();
      },
      LOAD,
    );
  }, CASE_TIMEOUT);

  it('its action narrows the list to exactly the results it counts', async () => {
    const user = userEvent.setup();
    renderList();
    await waitForRows();

    await user.click(await screen.findByRole('button', { name: /^Show/ }, LOAD));

    await waitFor(
      () => {
        expect(screen.getByText('Showing them now.')).toBeInTheDocument();
      },
      LOAD,
    );
    expect(screen.getByText('Flag: Critical value')).toBeInTheDocument();
    expect(screen.getByText('Review: Awaiting review')).toBeInTheDocument();
  }, CASE_TIMEOUT);
});

describe('mark reviewed — the fail-closed path (D-11)', () => {
  async function openCriticalReview(user: ReturnType<typeof userEvent.setup>) {
    renderList();
    await waitForRows();

    const all = await labService.listLabTests();
    const critical = inboxTests(all).find((test) => test.hasCriticalResult);
    expect(critical).toBeDefined();

    const button = await screen.findByRole(
      'button',
      {
        name: new RegExp(`Acknowledge the critical values on ${critical!.id} `),
      },
      LOAD,
    );
    await user.click(button);
    return critical!;
  }

  it('refuses to confirm a critical result until every value is ticked and a note is written', async () => {
    const user = userEvent.setup();
    const critical = await openCriticalReview(user);

    const dialog = await screen.findByRole('alertdialog', undefined, LOAD);
    const confirm = within(dialog).getByRole('button', { name: /Acknowledge & mark reviewed/ });

    // Nothing acknowledged: clicking writes nothing. Asserting the write did
    // not happen, not that the button carried an attribute.
    await user.click(confirm);
    await expect(labService.getLabTest(critical.id)).resolves.toHaveProperty('review', null);

    // Ticked, but with no note — still nothing.
    for (const box of within(dialog).getAllByRole('checkbox')) {
      await user.click(box);
    }
    await user.click(confirm);
    await expect(labService.getLabTest(critical.id)).resolves.toHaveProperty('review', null);
    expect(
      within(dialog).getByText(/needs a short note saying what was done about it/),
    ).toBeInTheDocument();
  }, CASE_TIMEOUT);

  it('writes the review, with the note and the acknowledged values, once both are given', async () => {
    const user = userEvent.setup();
    const critical = await openCriticalReview(user);

    const dialog = await screen.findByRole('alertdialog', undefined, LOAD);
    for (const box of within(dialog).getAllByRole('checkbox')) {
      await user.click(box);
    }
    await user.type(
      within(dialog).getByRole('textbox', { name: /What was done about it/ }),
      'Patient called; repeat sample requested.',
    );
    await user.click(within(dialog).getByRole('button', { name: /Acknowledge & mark reviewed/ }));

    await waitFor(
      async () => {
        const updated = await labService.getLabTest(critical.id);
        expect(updated.review).not.toBeNull();
        expect(updated.review?.note).toBe('Patient called; repeat sample requested.');
        expect(updated.review?.acknowledgedCriticalIds?.length).toBeGreaterThan(0);
      },
      LOAD,
    );
  }, CASE_TIMEOUT);

  it('a failed write keeps the result unreviewed and says so — no false success', async () => {
    const user = userEvent.setup();
    vi.spyOn(labService, 'markReviewed').mockRejectedValue(new Error('Network unavailable.'));

    const critical = await openCriticalReview(user);
    const dialog = await screen.findByRole('alertdialog', undefined, LOAD);
    for (const box of within(dialog).getAllByRole('checkbox')) {
      await user.click(box);
    }
    await user.type(
      within(dialog).getByRole('textbox', { name: /What was done about it/ }),
      'Patient called.',
    );
    await user.click(within(dialog).getByRole('button', { name: /Acknowledge & mark reviewed/ }));

    await waitFor(
      () => {
        expect(
          within(dialog).getByText(/still awaiting review/i),
        ).toBeInTheDocument();
      },
      LOAD,
    );
    // The dialog stayed open, and the store is untouched.
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    await expect(labService.getLabTest(critical.id)).resolves.toHaveProperty('review', null);
  }, CASE_TIMEOUT);
});


describe('bulk review (UX §2.6: bulk allowed only for Normal)', () => {
  /*
   * Selection lives on the DataTable, which is md+. jsdom's `matchMedia`
   * stub answers false to everything, so this suite answers true for the one
   * query `useMediaQuery` asks — the alternative is asserting the bulk rule
   * on a viewport where the control does not exist.
   */
  beforeEach(() => {
    window.matchMedia = (query: string) => ({
      matches: query === '(min-width: 768px)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    });
  });

  it('reviews the normal results and refuses the abnormal ones by name', async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByRole('table', undefined, LOAD);

    const all = await labService.listLabTests();
    const inbox = inboxTests(all);
    const { eligible, refused } = partitionForBulkReview(inbox);
    expect(eligible.length).toBeGreaterThan(0);
    expect(refused.length).toBeGreaterThan(0);

    // Select every row on the page.
    await user.click(screen.getByRole('checkbox', { name: /select all/i }));
    await user.click(screen.getByRole('button', { name: 'Mark reviewed' }));

    const dialog = await screen.findByRole('alertdialog', undefined, LOAD);
    expect(
      within(dialog).getByText('These will not — review them individually'),
    ).toBeInTheDocument();
    // The refusal names each one and why, rather than silently skipping it.
    expect(
      within(dialog).getAllByText(/Has values outside the reference range/).length,
    ).toBeGreaterThan(0);

    const confirm = within(dialog).getByRole('button', { name: /^Mark \d+ reviewed$/ });
    await user.click(confirm);

    await waitFor(
      async () => {
        const after = await labService.listLabTests();
        for (const test of eligible) {
          expect(after.find((entry) => entry.id === test.id)?.review).not.toBeNull();
        }
      },
      LOAD,
    );

    // Nothing abnormal was cleared by the bulk action.
    const after = await labService.listLabTests();
    for (const { test } of refused.filter((entry) => entry.reason === 'not-normal')) {
      expect(after.find((entry) => entry.id === test.id)?.review).toBeNull();
    }
  }, CASE_TIMEOUT);
});

/**
 * MED-SEC-014 — the worklist shows the caller's scope and nothing wider.
 *
 * The backend fix (`e3dbe9bf`) restores the care scope on a server-side
 * search. These pin the frontend half of that contract: the page renders
 * exactly the orders the service served, patient-name and MRN search narrow
 * WITHIN them in the browser (never a second, wider request), the counts are
 * tallies of the served orders, and a failed load names no patient.
 *
 * Synthetic patients only — no real data.
 */
describe('MED-SEC-014 — the worklist shows the served scope and nothing wider', () => {
  const PATIENT_A = { name: 'Synthetic Patient Alpha', mrn: 'SYN-0001' };
  const PATIENT_B = { name: 'Synthetic Patient Bravo', mrn: 'SYN-0002' };
  /** A patient the server did NOT serve to this doctor. */
  const OUT_OF_SCOPE = { name: 'Synthetic Patient Zulu', mrn: 'SYN-9999' };

  async function serveTwoOrders() {
    const [first, second] = await labService.listLabTests();
    if (!first || !second) throw new Error('the seeded corpus has fewer than two orders');
    const served = [
      { ...first, id: 'LAB-SYN-1', patient: { ...first.patient, id: 'PT-SYN-1', ...PATIENT_A } },
      { ...second, id: 'LAB-SYN-2', patient: { ...second.patient, id: 'PT-SYN-2', ...PATIENT_B } },
    ];
    const list = vi.spyOn(labService, 'listLabTests').mockResolvedValue(served);
    return { served, list };
  }

  async function searchFor(text: string) {
    const user = userEvent.setup();
    const box = await screen.findByRole('searchbox', { name: 'Search laboratory tests' }, LOAD);
    await user.clear(box);
    await user.type(box, text);
  }

  it('renders exactly the served orders, and counts only them', async () => {
    await serveTwoOrders();
    renderList('?tab=all');

    expect(await screen.findByText(PATIENT_A.name, undefined, LOAD)).toBeInTheDocument();
    expect(screen.getByText(PATIENT_B.name)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /All results/ })).toHaveTextContent('2');
    expect(screen.queryByText(OUT_OF_SCOPE.name)).not.toBeInTheDocument();
  }, CASE_TIMEOUT);

  it('narrows a patient-name search within the served orders, without a second request', async () => {
    const { list } = await serveTwoOrders();
    renderList('?tab=all');
    await screen.findByText(PATIENT_A.name, undefined, LOAD);
    const callsBefore = list.mock.calls.length;

    await searchFor('Bravo');

    await waitFor(() => {
      expect(screen.queryByText(PATIENT_A.name)).not.toBeInTheDocument();
    }, LOAD);
    expect(screen.getByText(PATIENT_B.name)).toBeInTheDocument();
    // Search is a filter over the served scope, never a new, wider fetch.
    expect(list.mock.calls.length).toBe(callsBefore);
  }, CASE_TIMEOUT);

  it('narrows an MRN search within the served orders', async () => {
    await serveTwoOrders();
    renderList('?tab=all');
    await screen.findByText(PATIENT_A.name, undefined, LOAD);

    await searchFor(PATIENT_A.mrn);

    await waitFor(() => {
      expect(screen.queryByText(PATIENT_B.name)).not.toBeInTheDocument();
    }, LOAD);
    expect(screen.getByText(PATIENT_A.name)).toBeInTheDocument();
  }, CASE_TIMEOUT);

  it('finds nothing — and names no one — for a patient outside the served scope', async () => {
    const { list } = await serveTwoOrders();
    renderList('?tab=all');
    await screen.findByText(PATIENT_A.name, undefined, LOAD);
    const callsBefore = list.mock.calls.length;

    await searchFor(OUT_OF_SCOPE.mrn);

    expect(
      await screen.findByText('Nothing matches the current search and filters.', undefined, LOAD),
    ).toBeInTheDocument();
    expect(screen.queryByText(PATIENT_A.name)).not.toBeInTheDocument();
    expect(screen.queryByText(PATIENT_B.name)).not.toBeInTheDocument();
    expect(screen.queryByText(OUT_OF_SCOPE.name)).not.toBeInTheDocument();
    expect(list.mock.calls.length).toBe(callsBefore);
  }, CASE_TIMEOUT);

  it('brings back only the served orders when the search is cleared', async () => {
    await serveTwoOrders();
    renderList('?tab=all');
    await screen.findByText(PATIENT_A.name, undefined, LOAD);
    await searchFor('Bravo');
    await waitFor(() => {
      expect(screen.queryByText(PATIENT_A.name)).not.toBeInTheDocument();
    }, LOAD);

    const user = userEvent.setup();
    await user.clear(screen.getByRole('searchbox', { name: 'Search laboratory tests' }));

    expect(await screen.findByText(PATIENT_A.name, undefined, LOAD)).toBeInTheDocument();
    expect(screen.getByText(PATIENT_B.name)).toBeInTheDocument();
    expect(screen.queryByText(OUT_OF_SCOPE.name)).not.toBeInTheDocument();
  }, CASE_TIMEOUT);

  it('drops the rows AND the counts when a refetch is refused after a good load', async () => {
    const { list } = await serveTwoOrders();
    renderList('?tab=all');
    await screen.findByText(PATIENT_A.name, undefined, LOAD);
    expect(screen.getByRole('tab', { name: /All results/ })).toHaveTextContent('2');

    // Access withdrawn between two reads: the server now refuses the worklist.
    list.mockRejectedValue(Object.assign(new Error('Forbidden'), { kind: 'forbidden' }));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Refresh laboratory tests' }));

    expect(
      await screen.findByText("Couldn't load laboratory tests", undefined, LOAD),
    ).toBeInTheDocument();
    // Nothing from the earlier, now-refused read survives — rows or tallies.
    expect(screen.queryByText(PATIENT_A.name)).not.toBeInTheDocument();
    expect(screen.queryByText(PATIENT_B.name)).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /All results/ })).not.toHaveTextContent('2');
  }, CASE_TIMEOUT);

  it('makes no laboratory request, and shows no patient, without an authenticated session', async () => {
    const { list } = await serveTwoOrders();
    const callsBefore = list.mock.calls.length;

    render(
      <MemoryRouter initialEntries={['/doctor/labs?tab=all']}>
        <AppProviders>
          <Routes>
            <Route element={<RequireAuth />}>
              <Route path="/doctor/labs" element={<LabsPage />} />
            </Route>
            <Route path="/login" element={<h1>Sign in</h1>} />
          </Routes>
        </AppProviders>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Sign in' }, LOAD)).toBeInTheDocument();
    expect(list.mock.calls.length).toBe(callsBefore);
    for (const name of [PATIENT_A.name, PATIENT_B.name, OUT_OF_SCOPE.name]) {
      expect(screen.queryByText(name)).not.toBeInTheDocument();
    }
  }, CASE_TIMEOUT);

  it('says the list could not load, and names no patient, when the read is refused', async () => {
    vi.spyOn(labService, 'listLabTests').mockRejectedValue(
      Object.assign(new Error('Forbidden'), { kind: 'forbidden' }),
    );
    renderList('?tab=all');

    expect(
      await screen.findByText("Couldn't load laboratory tests", undefined, LOAD),
    ).toBeInTheDocument();
    for (const name of [PATIENT_A.name, PATIENT_B.name, OUT_OF_SCOPE.name]) {
      expect(screen.queryByText(name)).not.toBeInTheDocument();
    }
  }, CASE_TIMEOUT);
});
