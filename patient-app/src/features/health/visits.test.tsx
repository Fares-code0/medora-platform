import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { act, fireEvent } from '@testing-library/react-native';

import type { ProfileStackParamList } from '@/navigation/routes';
import { renderWithProviders } from '@/test/render';

import type { VisitSummary } from './model/types';
import { HealthRecordsScreen } from './screens/HealthRecordsScreen';
import { VisitDetailScreen } from './screens/VisitDetailScreen';
import { VisitsScreen } from './screens/VisitsScreen';
import { healthService } from './service';

/**
 * Visit summaries — checklist J-08.
 *
 * ── What is actually being asserted here ─────────────────────────────
 *
 * A visit summary is the **patient projection** of `medical_records`,
 * not the clinician's note, and the highest-stakes rule on the screen is
 * the one AD-5 owns: a summary the clinic has not released is named and
 * **not rendered**. So the central test gives a withheld visit a
 * perfectly good summary string and asserts the patient never sees it —
 * a screen that only ever met `summary: null` on a held record would
 * pass by accident, which is exactly the shape of pass that lets an
 * unreviewed note reach a phone the day the fixture changes.
 *
 * The other three states are here because a blank is the failure J-06
 * names and it has three sources: a held record, a visit with no
 * summary written, and an id that is not in the record at all. Each one
 * says something specific.
 */

const installed: { mockRestore: () => void }[] = [];

afterEach(() => {
  for (const spy of installed.splice(0)) spy.mockRestore();
});

const visit = (overrides: Partial<VisitSummary> & Pick<VisitSummary, 'id'>): VisitSummary => ({
  title: 'Cardiology follow-up',
  visitedOn: '2026-08-20T10:00:00.000Z',
  doctorName: 'Dr Layla Haddad',
  summary: 'Blood pressure reviewed. Medication continued at the same dose.',
  release: 'released',
  ...overrides,
});

function stubVisits(visits: readonly VisitSummary[]) {
  const spy = jest.spyOn(healthService, 'listVisits').mockResolvedValue(visits);
  installed.push(spy);
  return spy;
}

async function renderList(visits: readonly VisitSummary[]) {
  stubVisits(visits);
  const navigation = { navigate: jest.fn() };
  const view = renderWithProviders(
    <VisitsScreen
      {...({
        navigation,
        route: { key: 'v-1', name: 'Visits', params: undefined },
      } as unknown as NativeStackScreenProps<ProfileStackParamList, 'Visits'>)}
    />,
  );
  await act(async () => undefined);
  return { ...view, navigate: navigation.navigate };
}

async function renderDetail(visits: readonly VisitSummary[], visitId: string) {
  stubVisits(visits);
  const view = renderWithProviders(
    <VisitDetailScreen
      {...({
        navigation: { navigate: jest.fn(), goBack: jest.fn() },
        route: { key: 'vd-1', name: 'VisitDetail', params: { visitId } },
      } as unknown as NativeStackScreenProps<ProfileStackParamList, 'VisitDetail'>)}
    />,
  );
  await act(async () => undefined);
  return view;
}

describe('the list of visits', () => {
  it('shows what the visit was, who it was with, and when', async () => {
    const { findByText } = await renderList([visit({ id: 'VS-1' })]);

    expect(await findByText('Cardiology follow-up')).toBeTruthy();
    expect(await findByText(/Dr Layla Haddad/)).toBeTruthy();
    // The date reads through the catalogue string and a real formatter.
    // Not pinned to a spelling: `Intl` orders "20 August 2026" and
    // "August 20, 2026" by locale data, and which one Node has is not
    // what this test is about.
    expect(await findByText(/^Seen .*2026$/)).toBeTruthy();
  });

  it('opens the summary it was asked for, by id', async () => {
    const view = await renderList([visit({ id: 'VS-1' }), visit({ id: 'VS-2' })]);

    fireEvent.press(await view.findByTestId('visit-VS-2'));

    expect(view.navigate).toHaveBeenCalledWith('VisitDetail', { visitId: 'VS-2' });
  });

  it('keeps a withheld visit in the list, and names why it is held', async () => {
    // Filtering it out would leave a patient certain the visit never
    // happened — J-06's rule, and it is the same rule here.
    const view = await renderList([visit({ id: 'VS-9', release: 'not-released' })]);

    expect(await view.findByTestId('visit-VS-9')).toBeTruthy();
    expect(await view.findByText(/Not shared with you/i)).toBeTruthy();
  });

  it('says nothing has been written yet rather than showing an empty page', async () => {
    const view = await renderList([]);

    expect(await view.findByText(/No visit summaries yet/i)).toBeTruthy();
  });
});

describe('one visit summary', () => {
  it('renders the projection as written, and adds nothing to it', async () => {
    const view = await renderDetail([visit({ id: 'VS-1' })], 'VS-1');

    expect(
      await view.findByText('Blood pressure reviewed. Medication continued at the same dose.'),
    ).toBeTruthy();
    expect(view.queryByTestId('visit-detail-release')).toBeNull();
  });

  it('shows NO summary text when the visit has not been released (AD-5)', async () => {
    const held = visit({
      id: 'VS-9',
      release: 'not-released',
      // Deliberately present. A held record whose body happened to be
      // null would prove nothing about the gate.
      summary: 'Discussed a possible referral to oncology.',
    });
    const view = await renderDetail([held], 'VS-9');

    expect(await view.findByTestId('visit-detail-release')).toBeTruthy();
    expect(view.queryByText(/oncology/i)).toBeNull();
    expect(view.queryByTestId('visit-detail-summary')).toBeNull();
  });

  it('says so when the visit is released and no summary was written', async () => {
    const view = await renderDetail([visit({ id: 'VS-2', summary: null })], 'VS-2');

    expect(await view.findByText(/has not written a summary/i)).toBeTruthy();
  });

  it('answers rather than spins when the id is not in the record', async () => {
    const view = await renderDetail([visit({ id: 'VS-1' })], 'VS-404');

    expect(await view.findByText(/not in your record/i)).toBeTruthy();
    expect(view.queryByTestId('visit-detail-loading')).toBeNull();
  });

  it('repeats on the detail that this is not the clinician’s note', async () => {
    const view = await renderDetail([visit({ id: 'VS-1' })], 'VS-1');

    expect(await view.findByText(/not the full note your clinician keeps/i)).toBeTruthy();
  });
});

describe('the way in', () => {
  it('is on the health-records hub, beside the other record sections', async () => {
    const spies = [
      jest.spyOn(healthService, 'listAllergies').mockResolvedValue([]),
      jest.spyOn(healthService, 'listConditions').mockResolvedValue([]),
      jest.spyOn(healthService, 'listMedications').mockResolvedValue([]),
      jest.spyOn(healthService, 'listHistory').mockResolvedValue([]),
    ];
    installed.push(...spies);

    const navigation = { navigate: jest.fn() };
    const view = renderWithProviders(
      <HealthRecordsScreen
        {...({
          navigation,
          route: { key: 'hr-1', name: 'HealthRecords', params: undefined },
        } as unknown as NativeStackScreenProps<ProfileStackParamList, 'HealthRecords'>)}
      />,
    );
    await act(async () => undefined);

    fireEvent.press(await view.findByTestId('health-to-visits'));

    expect(navigation.navigate).toHaveBeenCalledWith('Visits');
  });
});
