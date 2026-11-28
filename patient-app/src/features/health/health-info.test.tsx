import fs from 'node:fs';
import path from 'node:path';

import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { apiClient } from '@/api/client';
import { patientInfoEndpoints } from '@/api/endpoints/patient-info';
import { renderWithProviders } from '@/test/render';

import { fixtureHealthService } from './fixtures/health-fixtures';
import { InsuranceScreen } from './screens/InsuranceScreen';
import { TestsScreen } from './screens/TestsScreen';
import { healthService } from './service';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate }),
}));

const ORDER = {
  id: 'LO-1',
  testName: 'Full blood count',
  category: 'Haematology',
  specimenType: 'Blood',
  requestedAt: '2026-11-01T08:00:00Z',
  collectedAt: null,
  completedAt: null,
  hospital: { id: 'H-1', name: 'City Hospital' },
  results: { available: false, reason: 'release_policy_pending' },
};
const page = (items: unknown[]) => ({
  data: { items, page: 1, pageSize: 20, totalItems: items.length, totalPages: 1 },
});

afterEach(() => {
  jest.restoreAllMocks();
  mockNavigate.mockClear();
});

describe('patient info endpoints', () => {
  it('calls me/lab-orders and me/insurance only', async () => {
    const get = jest.spyOn(apiClient, 'get');
    get.mockResolvedValueOnce(page([{ ...ORDER, status: 'in_progress' }]));
    get.mockResolvedValueOnce({
      data: {
        insurance: {
          providerName: 'P',
          plan: null,
          policyNumberLast4: '1234',
          validUntil: null,
          isActive: true,
        },
        authorizations: { available: false, reason: 'authorization_workflow_undecided' },
      },
    });
    await patientInfoEndpoints.labOrders({ page: 2 });
    await patientInfoEndpoints.insurance();
    expect(get.mock.calls.map((c) => c[0])).toEqual(['me/lab-orders', 'me/insurance']);
    expect(get.mock.calls[0]?.[1]).toEqual({ params: { page: 2 } });
  });

  it('refuses a payload that carries a result, value or flag', async () => {
    jest
      .spyOn(apiClient, 'get')
      .mockResolvedValue(page([{ ...ORDER, status: 'completed', value: '12.4', flag: 'high' }]));
    await expect(patientInfoEndpoints.labOrders()).rejects.toThrow();
  });

  it('refuses a status outside the four patient words', async () => {
    jest.spyOn(apiClient, 'get').mockResolvedValue(page([{ ...ORDER, status: 'PROCESSING' }]));
    await expect(patientInfoEndpoints.labOrders()).rejects.toThrow();
  });
});

describe('Tests screen', () => {
  it.each([
    ['awaiting_collection', 'Waiting for your sample'],
    ['in_progress', 'In progress'],
    ['completed', 'Completed'],
    ['cancelled', 'Cancelled'],
  ])('maps %s to its patient word, and never shows a result', async (status, label) => {
    jest.spyOn(healthService, 'listLabTests').mockResolvedValue({
      items: [
        {
          id: 'LO-1',
          testName: 'Full blood count',
          category: null,
          specimenType: null,
          status: status as 'completed',
          requestedAt: '2026-11-01T08:00:00Z',
          collectedAt: null,
          completedAt: null,
          hospitalName: 'City Hospital',
        },
      ],
      totalItems: 1,
      hasMore: false,
    });
    renderWithProviders(<TestsScreen />);
    await waitFor(() => expect(screen.getByTestId('test-status-LO-1')).toBeTruthy());
    expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    expect(screen.getByText('City Hospital')).toBeTruthy();
    expect(screen.queryByTestId('test-results-note-LO-1') !== null).toBe(status === 'completed');
    if (status === 'completed') {
      expect(
        screen.getByText('Results will be shared by your care team once released.'),
      ).toBeTruthy();
    }
    expect(screen.queryByText(/mg|mmol|normal|high|low|critical/i)).toBeNull();
  });

  it('sends an unlinked account to LinkRecord', async () => {
    jest
      .spyOn(healthService, 'listLabTests')
      .mockRejectedValue(
        Object.assign(new Error('x'), { kind: 'conflict', code: 'patient_not_linked', detail: '' }),
      );
    renderWithProviders(<TestsScreen />);
    fireEvent.press(await screen.findByTestId('not-linked-action'));
    expect(mockNavigate).toHaveBeenCalledWith('Tabs', {
      screen: 'ProfileTab',
      params: { screen: 'LinkRecord' },
    });
  });
});

describe('Insurance screen', () => {
  it('shows provider, plan, last four, validity and an honest authorizations notice', async () => {
    jest.spyOn(healthService, 'getInsurance').mockResolvedValue({
      insurance: {
        providerName: 'Example Cover',
        plan: 'Gold',
        policyNumberLast4: '4821',
        validUntil: '2027-06-30',
        isActive: true,
      },
    });
    renderWithProviders(<InsuranceScreen />);
    await waitFor(() => expect(screen.getByText('Example Cover')).toBeTruthy());
    expect(screen.getByText('Gold')).toBeTruthy();
    expect(screen.getByText('Policy number ending in 4821')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
    expect(screen.getByText('Approvals are not available yet')).toBeTruthy();
  });

  it('says so when nothing is on file, and still shows the notice', async () => {
    jest.spyOn(healthService, 'getInsurance').mockResolvedValue({ insurance: null });
    renderWithProviders(<InsuranceScreen />);
    await waitFor(() => expect(screen.getByText('No insurance on file')).toBeTruthy());
    expect(screen.getByTestId('insurance-authorizations')).toBeTruthy();
  });
});

describe('the clinical record is not reachable', () => {
  const SRC = path.resolve(__dirname, '..', '..');
  const read = (...p: string[]) => fs.readFileSync(path.join(SRC, ...p), 'utf8');

  it('has no screen, route or deep link for prescriptions, visits, documents or history', () => {
    for (const gone of ['Documents', 'Prescriptions', 'Visits', 'VisitDetail']) {
      expect(
        fs.existsSync(path.join(SRC, 'features', 'health', 'screens', `${gone}Screen.tsx`)),
      ).toBe(false);
    }
    const routes =
      read('navigation', 'routes.ts') +
      read('navigation', 'AppTabs.tsx') +
      read('navigation', 'linking.ts');
    expect(routes).not.toMatch(/Prescriptions|VisitDetail|Visits:|Documents|LabResults/);
    expect(read('navigation', 'linking.ts')).toContain("Tests: 'records/labs'");
  });

  it('keeps clinical fixtures out of the model, even for mock builds', async () => {
    expect(Object.keys(fixtureHealthService).sort()).toEqual([
      'getInsurance',
      'listEmergencyContacts',
      'listLabTests',
    ]);
    const tests = await fixtureHealthService.listLabTests(1);
    expect(JSON.stringify(tests)).not.toMatch(/value|flag|result|interpretation/i);
  });
});
