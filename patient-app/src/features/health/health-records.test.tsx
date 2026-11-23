import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { act, waitFor } from '@testing-library/react-native';

import type { ProfileStackParamList } from '@/navigation/routes';
import { renderWithProviders } from '@/test/render';
import { ALLERGY_SEVERITIES, HISTORY_EVENT_KINDS, MEDICATION_STATUSES } from '@/types/vocabularies';

import type { Allergy, ChronicCondition, HistoryEvent, Medication } from './model/types';
import { HealthRecordsScreen } from './screens/HealthRecordsScreen';
import { healthService } from './service';

/**
 * The health-records hub — checklist J-02, J-03, J-04.
 *
 * `HealthRecordsScreen.tsx` was at 0% of its branches, and the branch
 * that matters is the one deciding whether a **severe** allergy looks
 * different from a mild one.
 *
 * The doctor app pins a fixed allergy strip to the top of every patient
 * screen for a reason that transfers directly: a severe allergy is the
 * one piece of a record that changes what a clinician does in an
 * emergency, and a patient showing their phone to a paramedic needs it at
 * the top and unmistakable.
 *
 * "Unmistakable" here means **three independent signals, not one colour**:
 * the card tone, an alert icon, and the word *Severe* written out. Colour
 * alone fails a red-green colourblind paramedic, a low-brightness screen
 * in daylight, and a greyscale accessibility mode — all three of which
 * happen at exactly the moment this matters.
 */

const allergy = (overrides: Partial<Allergy> & Pick<Allergy, 'id'>): Allergy => ({
  allergen: 'Penicillin',
  severity: 'mild',
  reaction: null,
  release: 'released',
  ...overrides,
});

const condition = (
  overrides: Partial<ChronicCondition> & Pick<ChronicCondition, 'id'>,
): ChronicCondition => ({
  name: 'Type 2 diabetes',
  diagnosedOn: null,
  release: 'released',
  ...overrides,
});

const medication = (overrides: Partial<Medication> & Pick<Medication, 'id'>): Medication => ({
  name: 'Metformin',
  dosage: '500 mg',
  frequency: 'twice daily',
  status: 'active',
  startedOn: null,
  release: 'released',
  ...overrides,
});

const historyEvent = (
  overrides: Partial<HistoryEvent> & Pick<HistoryEvent, 'id'>,
): HistoryEvent => ({
  kind: 'diagnosis',
  title: 'Hypertension',
  occurredOn: '2020-01-01T00:00:00.000Z',
  detail: null,
  release: 'released',
  ...overrides,
});

const installed: { mockRestore: () => void }[] = [];

afterEach(() => {
  for (const spy of installed.splice(0)) spy.mockRestore();
});

async function renderRecords(
  data: {
    allergies?: readonly Allergy[];
    conditions?: readonly ChronicCondition[];
    medications?: readonly Medication[];
    history?: readonly HistoryEvent[];
  } = {},
  locale: 'en' | 'ar' = 'en',
) {
  const spies = [
    jest.spyOn(healthService, 'listAllergies').mockResolvedValue(data.allergies ?? []),
    jest.spyOn(healthService, 'listConditions').mockResolvedValue(data.conditions ?? []),
    jest.spyOn(healthService, 'listMedications').mockResolvedValue(data.medications ?? []),
    jest.spyOn(healthService, 'listHistory').mockResolvedValue(data.history ?? []),
  ];
  installed.push(...spies);

  const view = renderWithProviders(
    <HealthRecordsScreen
      {...({
        navigation: { navigate: jest.fn() },
        route: { key: 'hr-1', name: 'HealthRecords', params: undefined },
      } as unknown as NativeStackScreenProps<ProfileStackParamList, 'HealthRecords'>)}
    />,
    { locale },
  );
  await act(async () => undefined);
  /**
   * Wait for the data, not for the chrome — and give it room.
   *
   * Two things made this flaky, and both had to change.
   *
   * It waited on the "Allergies" heading, which `Section` renders long
   * before any query resolves: a proof of that is trivial — mock the
   * service to never settle and the heading is still there. So the wait
   * returned while all four boundaries were still showing skeletons, and
   * an assertion about a row the test had just supplied could run before
   * the row existed. Each `AsyncBoundary` renders
   * `<SkeletonList testID="…-loading">` while `isPending`, so their
   * absence is the honest "the data has landed" signal, and it reads the
   * same whether the fixture was a full list or an empty one.
   *
   * That alone still failed, differently: this screen mounts four
   * concurrent queries, and on a contended worker the render and their
   * resolution can take longer than RNTL's 1000 ms default. The timeout
   * is explicit and generous because it is a ceiling on pathology, not a
   * pause — the wait returns as soon as the skeletons go, which is a few
   * milliseconds on an idle machine.
   *
   * And for a while it could not reach that ceiling: Jest's own per-test
   * timeout defaulted to 5 s, so the test died at five while this waited
   * to ten, and the failure named the harness rather than the queries.
   * `jest.config.js` now sets `testTimeout` above every ceiling in the
   * suite, and `coverage-config.test.ts` asserts the relationship so a
   * longer wait added later fails next to the config it needs to change.
   */
  const sections = ['allergies', 'conditions', 'medications', 'history'];
  // Poll with a plain presence check, not `expect(...).toBeNull()`: a failing
  // `toBeNull` on a test instance pretty-prints the whole fiber graph into its
  // message, about two seconds of CPU per poll that `waitFor` then throws
  // away — measured 2026-11-10, Phase 0. The assertion itself is unchanged
  // and runs once, after the wait, where it costs nothing when it passes.
  await waitFor(
    () => {
      const loading = sections.filter((s) => view.queryByTestId(`health-${s}-loading`) !== null);
      if (loading.length > 0) throw new Error(`still loading: ${loading.join(', ')}`);
    },
    { timeout: 10_000 },
  );
  for (const section of sections) {
    expect(view.queryByTestId(`health-${section}-loading`)).toBeNull();
  }
  return view;
}

type Node = { props: Record<string, unknown> };

/** Depth-first testIDs, which is reading order. */
function order(view: { UNSAFE_root: { findAll: (p: (n: Node) => boolean) => Node[] } }) {
  return view.UNSAFE_root.findAll((node: Node) => typeof node.props.testID === 'string').map(
    (node: Node) => String(node.props.testID),
  );
}

/**
 * Reading order with each id appearing once.
 *
 * `order` sees a `testID` on every host node carrying it, and `Card`
 * forwards its own down a nesting of `View`s — so a three-card list comes
 * back as nine entries. The `indexOf` assertions above do not care;
 * a whole-sequence assertion does, and comparing against the tripled list
 * would encode `Card`'s internal depth into a test about sort order.
 * A `Set` keeps first occurrence, which is the position on the screen.
 */
function readingOrder(
  view: { UNSAFE_root: { findAll: (p: (n: Node) => boolean) => Node[] } },
  prefix: string,
) {
  return [...new Set(order(view).filter((id) => id.startsWith(prefix)))];
}

describe('a severe allergy is unmistakable (J-02)', () => {
  it('says the word, so colour is never the only signal', async () => {
    const view = await renderRecords({
      allergies: [allergy({ id: 'AL-1', severity: 'severe', allergen: 'Penicillin' })],
    });

    // A red-green colourblind paramedic, a screen at minimum brightness in
    // daylight, and greyscale accessibility mode all lose the tone. None
    // of them loses the word.
    expect(view.getByText('Severe')).toBeTruthy();
    expect(view.getByText('Penicillin')).toBeTruthy();
  });

  it('carries an icon as well as a colour', async () => {
    const view = await renderRecords({
      allergies: [allergy({ id: 'AL-1', severity: 'severe' })],
    });

    const card = view.getByTestId('allergy-AL-1');
    // The alert icon is inside the severe card and only inside it.
    const icons = (card as unknown as { findAll: (p: (n: Node) => boolean) => Node[] }).findAll(
      (node: Node) => node.props.name === 'alert',
    );
    expect(icons.length).toBeGreaterThan(0);
  });

  it('gives a mild allergy none of that treatment', async () => {
    const view = await renderRecords({
      allergies: [allergy({ id: 'AL-2', severity: 'mild', allergen: 'Latex' })],
    });

    const card = view.getByTestId('allergy-AL-2');
    const icons = (card as unknown as { findAll: (p: (n: Node) => boolean) => Node[] }).findAll(
      (node: Node) => node.props.name === 'alert',
    );
    expect(icons).toHaveLength(0);
    expect(view.getByText('Mild')).toBeTruthy();
  });

  it.each(ALLERGY_SEVERITIES)('renders %s with its own label', async (severity) => {
    const view = await renderRecords({ allergies: [allergy({ id: 'AL-3', severity })] });

    const label = severity.charAt(0).toUpperCase() + severity.slice(1);
    expect(view.getByText(label)).toBeTruthy();
  });

  it('puts allergies above conditions and medicines', async () => {
    // A patient handing their phone to a paramedic should not have to
    // scroll. This is the ordering the doctor app's fixed strip encodes.
    const view = await renderRecords({
      allergies: [allergy({ id: 'AL-1', severity: 'severe' })],
      medications: [medication({ id: 'MD-1' })],
    });

    const ids = order(view);
    expect(ids.indexOf('allergy-AL-1')).toBeGreaterThan(-1);
    expect(ids.indexOf('allergy-AL-1')).toBeLessThan(ids.indexOf('medication-MD-1'));
  });

  it('renders the reaction when there is one, and nothing when there is not', async () => {
    const withReaction = await renderRecords({
      allergies: [allergy({ id: 'AL-1', severity: 'severe', reaction: 'Anaphylaxis' })],
    });
    expect(withReaction.getByText('Anaphylaxis')).toBeTruthy();

    const without = await renderRecords({ allergies: [allergy({ id: 'AL-1' })] });
    expect(without.queryByText(/null|undefined/i)).toBeNull();
  });

  it('shows a withheld allergy rather than dropping it (AD-5)', async () => {
    const view = await renderRecords({
      allergies: [allergy({ id: 'AL-1', release: 'pending-review' })],
    });

    expect(view.getByTestId('allergy-AL-1')).toBeTruthy();
    expect(view.getByText(/Waiting for a clinician/i)).toBeTruthy();
  });
});

describe('conditions and medicines (J-03, J-04)', () => {
  it('renders a condition with no recorded date without saying "Recorded null"', async () => {
    const view = await renderRecords({
      conditions: [condition({ id: 'CD-1', name: 'Asthma', diagnosedOn: null })],
    });

    expect(view.getByText('Asthma')).toBeTruthy();
    expect(view.queryByText(/Recorded/)).toBeNull();
  });

  it('dates a condition when the clinic recorded one', async () => {
    const view = await renderRecords({
      conditions: [condition({ id: 'CD-1', diagnosedOn: '2021-04-02T00:00:00.000Z' })],
    });

    expect(view.getByText(/Recorded .*2021/)).toBeTruthy();
  });

  it.each(MEDICATION_STATUSES)('labels a %s medicine with its own status', async (status) => {
    const view = await renderRecords({ medications: [medication({ id: 'MD-1', status })] });

    const label = status.charAt(0).toUpperCase() + status.slice(1);
    expect(view.getByText(label)).toBeTruthy();
  });

  it('renders the dose and the schedule together, because either alone is unsafe', async () => {
    const view = await renderRecords({
      medications: [medication({ id: 'MD-1', dosage: '500 mg', frequency: 'twice daily' })],
    });

    expect(view.getByText(/500 mg · twice daily/)).toBeTruthy();
  });
});

describe('nothing here is editable (OOS-2)', () => {
  it('says who to tell instead of offering an edit that would fail', async () => {
    const view = await renderRecords({
      allergies: [allergy({ id: 'AL-1', severity: 'severe' })],
      medications: [medication({ id: 'MD-1' })],
    });

    expect(view.getByText(/tell the clinic at your next appointment/i)).toBeTruthy();
    for (const affordance of [/^Edit$/i, /^Save$/i, /^Add$/i, /^Remove$/i, /^Delete$/i]) {
      expect(view.queryByText(affordance)).toBeNull();
    }
  });
});

describe('empty states', () => {
  it('says no allergies are recorded, which is not the same as none existing', async () => {
    const view = await renderRecords();

    expect(view.getByText('No allergies recorded')).toBeTruthy();
    expect(view.getByText('No long-term conditions recorded')).toBeTruthy();
    expect(view.getByText('No medicines recorded')).toBeTruthy();
    expect(view.getByText('Nothing recorded yet')).toBeTruthy();
  });
});

/**
 * The release gate, on every section rather than one of them.
 *
 * `model/types.ts` promises that every record on this screen carries a
 * `release` and that the screen renders all four outcomes honestly.
 * Allergies did. Conditions, medicines and history each dropped the
 * field, so a `pending-review` record rendered identically to a released
 * one — the patient could not tell that a clinician had not signed it off.
 *
 * A single test covering "the screen renders a notice somewhere" would
 * have passed throughout that, because the allergy section always did.
 * So there is one test per section, and each supplies a held record in
 * **only** its own section. The next section added to this screen gets its
 * own test or the pattern is obviously incomplete.
 */
describe('the release gate applies to every section, not just allergies', () => {
  it('names a held condition rather than rendering it as signed off (J-03)', async () => {
    const view = await renderRecords({
      conditions: [condition({ id: 'CD-1', name: 'Asthma', release: 'pending-review' })],
    });

    expect(view.getByTestId('condition-CD-1')).toBeTruthy();
    // Visible, and named — never filtered out and never a bare row.
    expect(view.getByText('Asthma')).toBeTruthy();
    expect(view.getByText(/Waiting for a clinician/i)).toBeTruthy();
  });

  it('names a medicine the clinic has not shared (J-04)', async () => {
    const view = await renderRecords({
      medications: [medication({ id: 'MD-1', release: 'not-released' })],
    });

    expect(view.getByTestId('medication-MD-1')).toBeTruthy();
    expect(view.getByText(/Not shared with you/i)).toBeTruthy();
  });

  it('names a held history event (J-05)', async () => {
    const view = await renderRecords({
      history: [historyEvent({ id: 'HE-1', release: 'pending-review' })],
    });

    expect(view.getByTestId('history-HE-1')).toBeTruthy();
    expect(view.getByText(/Waiting for a clinician/i)).toBeTruthy();
  });

  it('leaves a released record alone in all three', async () => {
    const view = await renderRecords({
      conditions: [condition({ id: 'CD-1' })],
      medications: [medication({ id: 'MD-1' })],
      history: [historyEvent({ id: 'HE-1' })],
    });

    // No notice anywhere: the gate is a response to a state, not chrome.
    expect(view.queryByText(/Waiting for a clinician/i)).toBeNull();
    expect(view.queryByText(/Not shared with you/i)).toBeNull();
    expect(view.queryByText(/Not ready yet/i)).toBeNull();
  });
});

/**
 * The medical-history timeline — checklist J-05.
 *
 * The row asks for two things the screen did not do: **all five kinds
 * render**, and **newest first**. It rendered `event.kind` raw — so a
 * patient read the lower-case enum `hospitalization` — in whatever order
 * the seam happened to return, and dropped `event.detail` entirely.
 */
describe('medical history (J-05)', () => {
  it.each(HISTORY_EVENT_KINDS)('labels a %s in words a patient reads', async (kind) => {
    const view = await renderRecords({ history: [historyEvent({ id: 'HE-1', kind })] });

    // The raw enum never reaches the screen. `hospitalization` is the one
    // that makes this worth asserting rather than assuming.
    expect(view.queryByText(kind)).toBeNull();
    expect(view.getByTestId('history-HE-1')).toBeTruthy();
  });

  it('gives every kind its own word, so five rows are five things', async () => {
    const view = await renderRecords({
      history: HISTORY_EVENT_KINDS.map((kind, index) =>
        historyEvent({
          id: `K${index}`,
          kind,
          title: `Event ${index}`,
          // Distinct dates, so the sort is deterministic and this test is
          // about the labels rather than about the order.
          occurredOn: `20${10 + index}-01-01T00:00:00.000Z`,
        }),
      ),
    });

    // All five render…
    expect(readingOrder(view, 'history-')).toHaveLength(HISTORY_EVENT_KINDS.length);

    // …and each reads as its own word. `clinical-word.ts` owns the rule —
    // it capitalises the literal rather than re-wording it, so the wire
    // value never reaches the screen and the vocabulary stays the one the
    // record is written in, which is W-10's to sign off rather than this
    // screen's to paraphrase.
    const labels = HISTORY_EVENT_KINDS.map((kind) => kind.charAt(0).toUpperCase() + kind.slice(1));
    expect(new Set(labels).size).toBe(HISTORY_EVENT_KINDS.length);
    for (const label of labels) expect(view.getByText(label)).toBeTruthy();
  });

  it('puts the newest event first whatever order the seam returns', async () => {
    const view = await renderRecords({
      history: [
        historyEvent({ id: 'OLD', occurredOn: '2015-03-01T00:00:00.000Z' }),
        historyEvent({ id: 'NEW', occurredOn: '2024-11-20T00:00:00.000Z' }),
        historyEvent({ id: 'MID', occurredOn: '2019-07-09T00:00:00.000Z' }),
      ],
    });

    const ids = readingOrder(view, 'history-');
    expect(ids).toEqual(['history-NEW', 'history-MID', 'history-OLD']);
  });

  it('sorts rather than trusting a list that is already ordered', async () => {
    // The inverse of the test above: a list handed over oldest-first must
    // come out reversed, not passed through.
    const view = await renderRecords({
      history: [
        historyEvent({ id: 'A', occurredOn: '2010-01-01T00:00:00.000Z' }),
        historyEvent({ id: 'B', occurredOn: '2020-01-01T00:00:00.000Z' }),
      ],
    });

    const ids = readingOrder(view, 'history-');
    expect(ids).toEqual(['history-B', 'history-A']);
  });

  it('does not scramble the list when a date cannot be read', async () => {
    // An unparseable date must not make the comparator return NaN: that
    // leaves `sort` free to emit any permutation, which is a worse bug
    // than a misplaced row because it is not reproducible.
    const view = await renderRecords({
      history: [
        historyEvent({ id: 'GOOD-OLD', occurredOn: '2012-01-01T00:00:00.000Z' }),
        historyEvent({ id: 'BROKEN', occurredOn: 'not a date' }),
        historyEvent({ id: 'GOOD-NEW', occurredOn: '2022-01-01T00:00:00.000Z' }),
      ],
    });

    const ids = readingOrder(view, 'history-');
    // The readable dates keep their order and the unreadable one sorts
    // last, where `formatLongDate` shows the raw string rather than
    // inventing a date for it.
    expect(ids).toEqual(['history-GOOD-NEW', 'history-GOOD-OLD', 'history-BROKEN']);
  });

  it('renders the detail when the clinic recorded one', async () => {
    const view = await renderRecords({
      history: [historyEvent({ id: 'HE-1', detail: 'Outpatient, no follow-up scheduled' })],
    });

    expect(view.getByText('Outpatient, no follow-up scheduled')).toBeTruthy();
  });

  it('says nothing at all when there is no detail', async () => {
    const view = await renderRecords({ history: [historyEvent({ id: 'HE-1', detail: null })] });

    expect(view.queryByText(/null|undefined/i)).toBeNull();
  });

  it('sits in the record, above the links out to labs and documents (J-01)', async () => {
    // J-01's section order is allergies, conditions, medicines, history,
    // then labs/prescriptions/documents. History used to render after the
    // links, which put a navigation block inside the record.
    const view = await renderRecords({
      medications: [medication({ id: 'MD-1' })],
      history: [historyEvent({ id: 'HE-1' })],
    });

    const ids = order(view);
    expect(ids.indexOf('medication-MD-1')).toBeLessThan(ids.indexOf('history-HE-1'));
    expect(ids.indexOf('history-HE-1')).toBeLessThan(ids.indexOf('health-to-labs'));
  });
});

describe('a medicine says when it was started', () => {
  it('dates it when the clinic recorded a start', async () => {
    const view = await renderRecords({
      medications: [medication({ id: 'MD-1', startedOn: '2023-06-15T00:00:00.000Z' })],
    });

    expect(view.getByText(/Started .*2023/)).toBeTruthy();
  });

  it('says nothing rather than "Started null" when it did not', async () => {
    const view = await renderRecords({
      medications: [medication({ id: 'MD-1', startedOn: null })],
    });

    expect(view.queryByText(/Started/)).toBeNull();
  });
});

/**
 * The clinical vocabulary in Arabic — W-10 translation approval,
 * 2026-11-23. The word is still there (J-02: colour is never the only
 * signal); it is the Arabic word. The Arabic is an engineering draft
 * awaiting the clinical reviewer (docs/SIGNOFF.md). The allergen is
 * clinical record data and stays as recorded.
 */
describe('a severe allergy is unmistakable in Arabic too', () => {
  it('says the Arabic word, and leaves the allergen as recorded', async () => {
    const view = await renderRecords(
      { allergies: [allergy({ id: 'AL-1', severity: 'severe', allergen: 'Penicillin' })] },
      'ar',
    );

    expect(view.getByText('شديدة')).toBeTruthy();
    expect(view.getByText('Penicillin')).toBeTruthy();
    expect(view.queryByText('Severe')).toBeNull();
  });
});
