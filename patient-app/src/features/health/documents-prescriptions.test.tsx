import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { RefreshControl } from 'react-native';

import { en } from '@/i18n/messages';
import { renderWithProviders } from '@/test/render';
import type { ApiError } from '@/types/api';
import { DOCUMENT_CATEGORIES, PRESCRIPTION_STATUSES } from '@/types/vocabularies';

import type { PatientDocument, Prescription } from './model/types';
import { DocumentsScreen } from './screens/DocumentsScreen';
import { PrescriptionsScreen } from './screens/PrescriptionsScreen';
import { healthService } from './service';

/**
 * Documents and prescriptions — checklist J-07, J-09.
 *
 * ── The branch that matters, and had 0% coverage ────────────────────
 *
 * `DocumentsScreen` decides, per document, whether to offer a way to
 * open it. That decision is the **malware scan gate**: the backend's
 * `File` register answers `403 scan_pending` until a file has been
 * scanned clean, and J-09 says in as many words that this is *not an
 * error to retry past*. A client that offered Open anyway would be
 * defeating a control the server pays for — and the whole of that
 * decision was three untested ternaries.
 *
 * All three states are asserted below, including the one nobody plans
 * for: a file the scanner **blocked**. A patient must be told it exists
 * and cannot be opened, rather than being shown a button that fails or a
 * list that quietly omits their letter.
 *
 * ── Prescriptions ───────────────────────────────────────────────────
 *
 * Read-only, permanently (OOS-2). The tests here pin two things a
 * refactor could take away without any other suite noticing: that no
 * affordance to request a refill exists, and that the count of refills
 * left is rendered only when the clinic actually recorded one — "null
 * refills left" is worse than silence on a screen about medicine.
 */

const documentFixture = (
  overrides: Partial<PatientDocument> & Pick<PatientDocument, 'id'>,
): PatientDocument => ({
  title: 'Referral letter',
  category: 'referral',
  uploadedOn: '2026-08-01T09:00:00.000Z',
  scanState: 'clean',
  release: 'released',
  ...overrides,
});

const prescriptionFixture = (
  overrides: Partial<Prescription> & Pick<Prescription, 'id'>,
): Prescription => ({
  medicationName: 'Amoxicillin',
  dosage: '500 mg',
  frequency: 'three times daily',
  status: 'active',
  issuedOn: '2026-08-20T09:00:00.000Z',
  refillsRemaining: null,
  release: 'released',
  ...overrides,
});

const installed: { mockRestore: () => void }[] = [];

afterEach(() => {
  for (const spy of installed.splice(0)) spy.mockRestore();
});

/**
 * Wait until a list's skeleton is gone. Polls with a plain presence check,
 * not `expect(...).toBeNull()`: a failing `toBeNull` on a test instance
 * pretty-prints the whole fiber graph into its message, about two seconds
 * of CPU per poll that `waitFor` then throws away — measured 2026-11-10,
 * Phase 0. The assertion itself is unchanged and runs once, after the wait.
 */
async function settled(view: { queryByTestId: (id: string) => unknown }, testID: string) {
  await waitFor(
    () => {
      if (view.queryByTestId(testID) !== null) throw new Error(`${testID} is still on screen`);
    },
    { timeout: 10_000 },
  );
  expect(view.queryByTestId(testID)).toBeNull();
}

async function renderDocuments(documents: readonly PatientDocument[]) {
  installed.push(jest.spyOn(healthService, 'listDocuments').mockResolvedValue(documents));

  const view = renderWithProviders(<DocumentsScreen />);
  await act(async () => undefined);
  await settled(view, 'documents-list-loading');
  return view;
}

async function renderPrescriptions(prescriptions: readonly Prescription[]) {
  installed.push(jest.spyOn(healthService, 'listPrescriptions').mockResolvedValue(prescriptions));

  const view = renderWithProviders(<PrescriptionsScreen />);
  await act(async () => undefined);
  await settled(view, 'prescriptions-list-loading');
  return view;
}

describe('the scan gate (J-09)', () => {
  it('offers a way in only for a file that has been scanned clean', async () => {
    const view = await renderDocuments([documentFixture({ id: 'DOC-1' })]);

    expect(view.getByTestId('document-open-DOC-1')).toBeTruthy();
  });

  it('offers nothing for a file still being scanned, and says why', async () => {
    const view = await renderDocuments([documentFixture({ id: 'DOC-2', scanState: 'pending' })]);

    // No button at all — not a disabled one. A disabled control invites
    // a patient to keep pressing it, and the wait is the server's.
    expect(view.queryByTestId('document-open-DOC-2')).toBeNull();
    expect(view.getByText(/being checked for safety/i)).toBeTruthy();
  });

  it('names a blocked file rather than hiding it, and says the clinic knows', async () => {
    const view = await renderDocuments([
      documentFixture({ id: 'DOC-3', title: 'Discharge summary', scanState: 'blocked' }),
    ]);

    // Dropping it from the list would leave a patient certain the clinic
    // never sent it; offering Open would defeat the scan.
    expect(view.getByText('Discharge summary')).toBeTruthy();
    expect(view.queryByTestId('document-open-DOC-3')).toBeNull();
    expect(view.getByText(/could not be checked/i)).toBeTruthy();
    expect(view.getByText(/clinic has been told/i)).toBeTruthy();
  });

  it('says the download is not built rather than failing at it', async () => {
    // BE-15 is unbuilt: there is no object storage behind
    // `File.storage_key`. Pressing Open explains that. The alternative —
    // a button that throws, or one that silently does nothing — is how a
    // patient concludes the app is broken and stops trusting the rest of
    // it.
    const view = await renderDocuments([documentFixture({ id: 'DOC-1' })]);

    fireEvent.press(view.getByTestId('document-open-DOC-1'));

    expect(await view.findByText(/not available yet/i)).toBeTruthy();
  });

  it('says nothing is there rather than showing an empty card', async () => {
    const view = await renderDocuments([]);

    expect(view.getByText('No documents')).toBeTruthy();
  });

  it('shows a withheld document as withheld, not as missing (AD-5)', async () => {
    const view = await renderDocuments([documentFixture({ id: 'DOC-4', release: 'not-released' })]);

    expect(view.getByText(/not shared with you/i)).toBeTruthy();
  });
});

describe('prescriptions are a record, not a request (J-07, OOS-2)', () => {
  it('renders the dose and the schedule together, because either alone is unsafe', async () => {
    const view = await renderPrescriptions([prescriptionFixture({ id: 'RX-1' })]);

    expect(view.getByText('500 mg · three times daily')).toBeTruthy();
  });

  it('offers no control at all, which is how a read-only record stays one', async () => {
    // Prescribing is a clinician capability. A button that composed a
    // message asking for a refill would be a repeat prescription wearing
    // a different name, with none of the checks a real one has.
    //
    // Asserted as "no pressable element", not "no matching text": the
    // screen's own notice says repeat prescriptions are arranged with
    // the clinic, and that sentence is the point rather than a leak.
    const view = await renderPrescriptions([prescriptionFixture({ id: 'RX-1' })]);

    expect(view.queryAllByRole('button')).toEqual([]);
    expect(view.getByText(/arranged with your clinic/i)).toBeTruthy();
  });

  it('counts refills only when the clinic recorded a count', async () => {
    const withCount = await renderPrescriptions([
      prescriptionFixture({ id: 'RX-2', refillsRemaining: 2 }),
    ]);
    expect(withCount.getByText(/2 refills left/)).toBeTruthy();

    withCount.unmount();

    const without = await renderPrescriptions([
      prescriptionFixture({ id: 'RX-3', refillsRemaining: null }),
    ]);
    expect(without.queryByText(/refills left/)).toBeNull();
    expect(without.queryByText(/null/)).toBeNull();
  });

  // Seven statuses, each a full screen render — generous, because the
  // ceiling is on pathology and the loop returns as soon as each lands.
  it('gives every status of the vocabulary a word a patient can read', async () => {
    // The map is exhaustive over `PrescriptionStatus` by type. This is
    // the other half: each literal renders as prose, and never as the
    // database value — "pending-approval" is not a sentence.
    for (const status of PRESCRIPTION_STATUSES) {
      const view = await renderPrescriptions([prescriptionFixture({ id: `RX-${status}`, status })]);

      expect(view.queryByText(status)).toBeNull();
      view.unmount();
    }
  }, 30_000);
});

/**
 * The category badge, which used to be the raw database literal.
 *
 * `<Badge label={document.category} />` put `external-record` in front of
 * a patient looking at their own paperwork. `StatusBadge`'s docblock states
 * the rule — "the literal is never rendered" — and every sibling screen in
 * this feature already had a label map; this one did not.
 *
 * Driven off `DOCUMENT_CATEGORIES` rather than a list written here, so a
 * sixth category added to the vocabulary fails this test instead of
 * rendering its own literal.
 */
describe('a document names its kind in words, not in database values', () => {
  it.each(DOCUMENT_CATEGORIES)(
    'renders %s as a label rather than the literal',
    async (category) => {
      const view = await renderDocuments([documentFixture({ id: 'DOC-1', category })]);

      // The literal never reaches the screen…
      expect(view.queryByText(category)).toBeNull();
      // …and something is still rendered in its place, so this cannot be
      // satisfied by dropping the badge.
      expect(view.getByTestId('document-DOC-1')).toBeTruthy();
    },
  );

  it('spells out the hyphenated one, which is the case that made this obvious', async () => {
    const view = await renderDocuments([
      documentFixture({ id: 'DOC-1', category: 'external-record' }),
    ]);

    expect(view.getByText('External record')).toBeTruthy();
    expect(view.queryByText('external-record')).toBeNull();
  });

  it('gives every category its own word', async () => {
    // A map with a duplicated value would render two kinds of document
    // identically, which is the failure a per-category test cannot see.
    const labels = ['Referral', 'Consent form', 'External record', 'Insurance', 'Report'];
    expect(new Set(labels).size).toBe(DOCUMENT_CATEGORIES.length);

    const view = await renderDocuments(
      DOCUMENT_CATEGORIES.map((category, index) =>
        documentFixture({ id: `DOC-${index}`, category, title: `Paper ${index}` }),
      ),
    );

    for (const label of labels) expect(view.getByText(label)).toBeTruthy();
  });
});

describe('pull to refresh', () => {
  it('refetches the documents when the screen is pulled down', async () => {
    const view = await renderDocuments([documentFixture({ id: 'DOC-1' })]);
    const spy = jest.spyOn(healthService, 'listDocuments');
    const before = spy.mock.calls.length;

    await act(async () => {
      view.UNSAFE_getByType(RefreshControl).props.onRefresh();
    });

    await waitFor(() => expect(spy.mock.calls.length).toBe(before + 1));
  });

  it('refetches the prescriptions when the screen is pulled down', async () => {
    const view = await renderPrescriptions([]);
    const spy = jest.spyOn(healthService, 'listPrescriptions');
    const before = spy.mock.calls.length;

    await act(async () => {
      view.UNSAFE_getByType(RefreshControl).props.onRefresh();
    });

    await waitFor(() => expect(spy.mock.calls.length).toBe(before + 1));
  });

  it('keeps the documents on screen when a refresh fails, and says so without blocking', async () => {
    const view = await renderDocuments([documentFixture({ id: 'DOC-1', title: 'Cached letter' })]);
    const network: ApiError = { kind: 'network' };
    const spy = jest.spyOn(healthService, 'listDocuments').mockRejectedValue(network);
    const before = spy.mock.calls.length;

    await act(async () => {
      view.UNSAFE_getByType(RefreshControl).props.onRefresh();
    });

    expect(await view.findByText(en['state.error.network.title'])).toBeTruthy();
    expect(view.getByText('Cached letter')).toBeTruthy();
    expect(view.queryByTestId('documents-list-error')).toBeNull();
    expect(view.UNSAFE_getByType(RefreshControl).props.refreshing).toBe(false);
    expect(spy.mock.calls.length).toBe(before + 1);
  });

  it('keeps the prescriptions on screen when a refresh fails, and says so without blocking', async () => {
    const view = await renderPrescriptions([
      prescriptionFixture({ id: 'RX-1', medicationName: 'Cached medicine' }),
    ]);
    const network: ApiError = { kind: 'network' };
    const spy = jest.spyOn(healthService, 'listPrescriptions').mockRejectedValue(network);
    const before = spy.mock.calls.length;

    await act(async () => {
      view.UNSAFE_getByType(RefreshControl).props.onRefresh();
    });

    expect(await view.findByText(en['state.error.network.title'])).toBeTruthy();
    expect(view.getByText('Cached medicine')).toBeTruthy();
    expect(view.queryByTestId('prescriptions-list-error')).toBeNull();
    expect(view.UNSAFE_getByType(RefreshControl).props.refreshing).toBe(false);
    expect(spy.mock.calls.length).toBe(before + 1);
  });
});
