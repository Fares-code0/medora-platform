import { act, fireEvent, waitFor } from '@testing-library/react-native';

import { renderWithProviders } from '@/test/render';
import { RELEASE_STATES, type ReleaseState } from '@/types/vocabularies';

import { ReleaseNotice } from './components/ReleaseNotice';
import type { LabOrder, LabOrderDetail } from './model/types';
import { LabResultsScreen } from './screens/LabResultsScreen';
import { healthService } from './service';

/**
 * The AD-5 release gate — checklist J-06, J-10.
 *
 * After Emergency this is the highest-stakes rendering rule in the app,
 * and nothing referenced it. `ReleaseNotice` is what a patient sees when
 * a record exists but has not been released to them, and the two obvious
 * implementations are both wrong in ways that reach a person:
 *
 * - **Filtering the record out** leaves a patient certain their lipid
 *   results were never taken.
 * - **Showing an error** makes a deliberate clinical decision look like a
 *   bug they should retry past.
 *
 * So a held record is visible, its state is named, there is a way to ask,
 * and no value is shown. These tests hold all four, and hold the two
 * absences that matter most: no retry affordance, and no interpretation.
 */

const WITHHELD = RELEASE_STATES.filter((state) => state !== 'released');

const installed: { mockRestore: () => void }[] = [];

afterEach(() => {
  for (const spy of installed.splice(0)) spy.mockRestore();
});

function notice(state: ReleaseState, mode: 'light' | 'dark' = 'light') {
  return renderWithProviders(<ReleaseNotice state={state} testID="notice" />, { mode });
}

/** The text a screen reader is handed for the whole notice. */
function announcement(state: ReleaseState): string {
  const view = notice(state);
  return String(view.getByTestId('notice').props.accessibilityLabel ?? '');
}

describe('a released record', () => {
  it('renders no notice at all, so nothing sits between the patient and their result', () => {
    expect(notice('released').queryByTestId('notice')).toBeNull();
  });
});

describe('a record that is not released', () => {
  it.each(WITHHELD)('%s is visible rather than filtered away', (state) => {
    expect(notice(state).getByTestId('notice')).toBeTruthy();
  });

  it.each(WITHHELD)('%s says something, and something specific to it', (state) => {
    const text = announcement(state);

    expect(text.length).toBeGreaterThan(30);
    expect(text).not.toMatch(/undefined|\[object/i);
  });

  it('gives each state its own words, because they call for different actions', () => {
    const announcements = WITHHELD.map(announcement);

    expect(new Set(announcements).size).toBe(WITHHELD.length);
  });

  it.each(WITHHELD)('%s offers no retry, because there is nothing to retry', (state) => {
    // A deliberate clinical decision is not a failed request. A Retry
    // button here teaches a patient to hammer a wall, and teaches them
    // that a held result is an app problem.
    const view = notice(state);

    expect(view.queryByText(/try again|retry|reload|refresh/i)).toBeNull();
    expect(announcement(state)).not.toMatch(/try again|retry/i);
  });

  it.each(WITHHELD)('%s does not read as an error', (state) => {
    expect(announcement(state)).not.toMatch(
      /error|failed|failure|something went wrong|unable to load|problem/i,
    );
  });

  it.each(WITHHELD)('%s offers no clinical interpretation (§19)', (state) => {
    // Not a word about what a result means, whether it is reassuring, or
    // what to do about it. That is practising medicine.
    expect(announcement(state)).not.toMatch(
      /abnormal|out of range|reference range|consult|you should|this means|don.t worry|nothing to worry/i,
    );
  });

  it('tells a patient how to ask when the clinic has simply not shared it', () => {
    expect(announcement('not-released')).toMatch(/ask|message/i);
  });

  it('says a clinician is looking, not that something is broken, while a review is pending', () => {
    const text = announcement('pending-review');

    expect(text).toMatch(/clinician/i);
    expect(text).toMatch(/review/i);
  });

  it.each(WITHHELD)('%s is announced as one region rather than three fragments', (state) => {
    const element = notice(state).getByTestId('notice');

    expect(element.props.accessible).toBe(true);
    expect(String(element.props.accessibilityLabel)).toContain('.');
  });

  it.each(WITHHELD)('%s renders in dark mode too', (state) => {
    expect(notice(state, 'dark').getByTestId('notice')).toBeTruthy();
  });
});

describe('the vocabulary is covered exhaustively', () => {
  it('has a presentation for every state the backend can send', () => {
    // A fifth release state added to `vocabularies.ts` without a
    // presentation here would render nothing on a record that is being
    // withheld — the blank J-06 exists to prevent. TypeScript catches it
    // at build time; this catches it if the type is ever widened.
    for (const state of RELEASE_STATES) {
      const view = notice(state);
      if (state === 'released') {
        expect(view.queryByTestId('notice')).toBeNull();
      } else {
        expect(view.getByTestId('notice')).toBeTruthy();
      }
    }
  });
});

// ── The screen, where the rule has to survive contact with a list ─────

const ORDER = (overrides: Partial<LabOrder> = {}): LabOrder => ({
  id: 'LAB-1',
  panelName: 'Lipid panel',
  orderedOn: '2026-08-30T09:00:00.000Z',
  status: 'completed',
  release: 'released',
  resultCount: 2,
  ...overrides,
});

const DETAIL = (overrides: Partial<LabOrderDetail> = {}): LabOrderDetail => ({
  ...ORDER(),
  results: [
    {
      id: 'R-1',
      analyteName: 'Total cholesterol',
      value: '6.4',
      unit: 'mmol/L',
      referenceRange: '< 5.0',
      flag: 'high',
      release: 'released',
    },
  ],
  ...overrides,
});

function stubLabs(orders: readonly LabOrder[], detail: LabOrderDetail) {
  const list = jest.spyOn(healthService, 'listLabOrders').mockResolvedValue(orders);
  const get = jest.spyOn(healthService, 'getLabOrder').mockResolvedValue(detail);
  installed.push(list, get);
}

async function renderLabs(orders: readonly LabOrder[], detail: LabOrderDetail) {
  stubLabs(orders, detail);
  const view = renderWithProviders(<LabResultsScreen />);
  await act(async () => undefined);
  return view;
}

describe('the lab list (J-06)', () => {
  it('keeps a withheld order in the list, so the patient knows the test happened', async () => {
    const { findByTestId } = await renderLabs(
      [ORDER({ id: 'LAB-9', release: 'pending-review' })],
      DETAIL(),
    );

    expect(await findByTestId('lab-summary-LAB-9')).toBeTruthy();
  });

  it('names the state on the summary card, beside the panel it belongs to', async () => {
    const { findByText } = await renderLabs(
      [ORDER({ id: 'LAB-9', release: 'pending-review' })],
      DETAIL(),
    );

    expect(await findByText('Lipid panel')).toBeTruthy();
    expect(await findByText(/Waiting for a clinician/i)).toBeTruthy();
  });

  it('shows no values when the order is opened and the results are not released', async () => {
    const withheld = DETAIL({
      id: 'LAB-9',
      release: 'pending-review',
      results: [
        {
          id: 'R-9',
          analyteName: 'Total cholesterol',
          value: '6.4',
          unit: 'mmol/L',
          referenceRange: '< 5.0',
          flag: 'critical-high',
          release: 'pending-review',
        },
      ],
    });
    const view = await renderLabs([ORDER({ id: 'LAB-9', release: 'pending-review' })], withheld);

    fireEvent.press(await view.findByTestId('lab-summary-LAB-9'));
    await waitFor(() => expect(view.getByTestId('lab-release-LAB-9')).toBeTruthy());

    // An unreviewed critical result reaching a patient's phone is the
    // thing AD-5 exists to prevent. The number, the unit, the range and
    // the flag are all absent.
    expect(view.queryByText('6.4')).toBeNull();
    expect(view.queryByText(/mmol\/L/)).toBeNull();
    expect(view.queryByText(/< 5\.0/)).toBeNull();
    expect(view.queryByText(/Critical/i)).toBeNull();
  });

  it('shows the values, and the lab’s own flag, once they are released', async () => {
    const view = await renderLabs([ORDER()], DETAIL());

    fireEvent.press(await view.findByTestId('lab-summary-LAB-1'));

    expect(await view.findByText(/6\.4/)).toBeTruthy();
    expect(view.queryByTestId('lab-release-LAB-1')).toBeNull();
  });

  it('says on the screen that it does not interpret them', async () => {
    const { findByText } = await renderLabs([ORDER()], DETAIL());

    expect(await findByText(/does not tell you what they mean/i)).toBeTruthy();
  });
});

/**
 * Expanding an order is a disclosure, and a disclosure closes.
 *
 * The expanded set only ever grew — `[...current, order.id]`, no removal
 * path, no control on the expanded card — so a patient who tapped a panel
 * to check one number was stuck scrolling past it for the rest of the
 * session, and someone with eight panels could end up with every one of
 * them open and no way back.
 */
describe('a lab order can be closed again (J-06)', () => {
  it('opens on a tap and closes on the button', async () => {
    const view = await renderLabs([ORDER()], DETAIL());

    fireEvent.press(await view.findByTestId('lab-summary-LAB-1'));
    // Open: the detail card is mounted and the summary is gone.
    expect(await view.findByTestId('lab-order-card-LAB-1')).toBeTruthy();
    expect(view.queryByTestId('lab-summary-LAB-1')).toBeNull();

    await act(async () => {
      fireEvent.press(view.getByTestId('lab-collapse-LAB-1'));
    });

    // Closed: back to the summary, with the values gone.
    expect(await view.findByTestId('lab-summary-LAB-1')).toBeTruthy();
    expect(view.queryByTestId('lab-order-card-LAB-1')).toBeNull();
    expect(view.queryByText(/6\.4/)).toBeNull();
  });

  it('can be opened again after being closed', async () => {
    // The regression the old code could not have: `filter` removing an id
    // that `includes` then refuses to re-add would pass the test above and
    // fail here.
    const view = await renderLabs([ORDER()], DETAIL());

    fireEvent.press(await view.findByTestId('lab-summary-LAB-1'));
    await view.findByTestId('lab-order-card-LAB-1');

    await act(async () => {
      fireEvent.press(view.getByTestId('lab-collapse-LAB-1'));
    });
    await view.findByTestId('lab-summary-LAB-1');

    fireEvent.press(view.getByTestId('lab-summary-LAB-1'));
    expect(await view.findByTestId('lab-order-card-LAB-1')).toBeTruthy();
  });

  it('closes only the order whose button was pressed', async () => {
    const view = await renderLabs(
      [ORDER({ id: 'LAB-1' }), ORDER({ id: 'LAB-2', panelName: 'Thyroid panel' })],
      DETAIL(),
    );

    fireEvent.press(await view.findByTestId('lab-summary-LAB-1'));
    fireEvent.press(await view.findByTestId('lab-summary-LAB-2'));
    await view.findByTestId('lab-order-card-LAB-2');

    await act(async () => {
      fireEvent.press(view.getByTestId('lab-collapse-LAB-1'));
    });

    expect(await view.findByTestId('lab-summary-LAB-1')).toBeTruthy();
    // The other one is untouched — expansion is per-order, not a mode.
    expect(view.getByTestId('lab-order-card-LAB-2')).toBeTruthy();
  });

  it('offers the button on a withheld order too, which is the one most likely to be opened by mistake', async () => {
    const view = await renderLabs([ORDER({ id: 'LAB-9', release: 'not-released' })], {
      ...DETAIL({ id: 'LAB-9', release: 'not-released' }),
    });

    fireEvent.press(await view.findByTestId('lab-summary-LAB-9'));
    await view.findByTestId('lab-release-LAB-9');

    // A card with nothing in it but a notice is exactly the one a patient
    // wants to shut, so the control lives outside the release branch.
    expect(view.getByTestId('lab-collapse-LAB-9')).toBeTruthy();
  });
});

describe('the summary says how much is behind it', () => {
  it('counts the results, which were fetched and never shown', async () => {
    const view = await renderLabs([ORDER({ resultCount: 2 })], DETAIL());

    expect(await view.findByText(/2 results/)).toBeTruthy();
  });

  it('says nothing at zero, because an order still at the laboratory has none', async () => {
    // "0 results" reads as a failure. `processing` is a stage, not one.
    const view = await renderLabs(
      [ORDER({ status: 'processing', resultCount: 0 })],
      DETAIL(),
    );

    await view.findByText('Lipid panel');
    // Matched against the separator rather than the bare word: the screen
    // is titled "Lab results" and its notice uses the word too, so a bare
    // /results/ asserts nothing about this line.
    expect(view.queryByText(/· \d+ results/)).toBeNull();
    expect(view.queryByText(/0 results/)).toBeNull();
  });
});
