import type { ComponentProps } from 'react';

import { fireEvent, waitFor } from '@testing-library/react-native';

import { hospitalEndpoints } from '@/api/endpoints/hospitals';
import { renderWithProviders } from '@/test/render';

import { HospitalDetailScreen } from './screens/HospitalDetailScreen';
import { HospitalsScreen } from './screens/HospitalsScreen';
import { hospitalService } from './service';

const navigation = { navigate: jest.fn(), goBack: jest.fn() };

const listProps = {
  navigation,
  route: { key: 'k', name: 'Hospitals' },
} as unknown as ComponentProps<typeof HospitalsScreen>;
const detailProps = {
  navigation,
  route: { key: 'k', name: 'Hospital', params: { hospitalId: 'HOS-1' } },
} as unknown as ComponentProps<typeof HospitalDetailScreen>;

afterEach(() => {
  jest.restoreAllMocks();
  navigation.navigate.mockClear();
});

describe('the hospital list', () => {
  it('lists hospitals and opens one', async () => {
    const view = renderWithProviders(<HospitalsScreen {...listProps} />);

    const card = await view.findByTestId('hospital-card-HOS-1');
    expect(view.getByText('Medora Clinic')).toBeTruthy();
    fireEvent.press(card);

    expect(navigation.navigate).toHaveBeenCalledWith('Hospital', {
      hospitalId: 'HOS-1',
      hospitalName: 'Medora Clinic',
    });
  });

  it('shows an empty state for a search with no match', async () => {
    jest
      .spyOn(hospitalService, 'list')
      .mockResolvedValue({ items: [], totalItems: 0, hasMore: false });
    const view = renderWithProviders(<HospitalsScreen {...listProps} />);

    expect(await view.findByText('No hospitals found')).toBeTruthy();
  });
});

describe('the hospital detail', () => {
  it('renders what the server sent, and opens Discover filtered by this hospital', async () => {
    const view = renderWithProviders(<HospitalDetailScreen {...detailProps} />);

    expect(await view.findByTestId('hospital-locations')).toBeTruthy();
    expect(view.getAllByText('Cardiology').length).toBeGreaterThan(0);
    fireEvent.press(view.getByTestId('hospital-find-doctors'));

    expect(navigation.navigate).toHaveBeenCalledWith('DiscoverRoot', {
      hospitalId: 'HOS-1',
      hospitalName: 'Medora Clinic',
    });
  });

  it('omits sections the server left empty instead of inventing them', async () => {
    jest.spyOn(hospitalService, 'getById').mockResolvedValue({
      id: 'HOS-2',
      name: 'Bare Hospital',
      description: null,
      phone: null,
      clinics: [],
      locations: [],
      departments: [],
      specialties: [],
    });
    const view = renderWithProviders(<HospitalDetailScreen {...detailProps} />);

    await view.findAllByText('Bare Hospital');
    expect(view.queryByTestId('hospital-locations')).toBeNull();
    expect(view.queryByTestId('hospital-call')).toBeNull();
    expect(view.queryByText('Clinics')).toBeNull();
  });
});

describe('the endpoint module', () => {
  it('reads GET /patient/hospitals with the query and page', async () => {
    const urls: string[] = [];
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      urls.push(String(input));
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: { items: [], page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    });

    await hospitalEndpoints.list({ q: 'med', page: 2 });

    const url = new URL(urls[0] ?? '');
    expect(url.pathname).toMatch(/\/patient\/hospitals$/);
    expect(url.searchParams.get('q')).toBe('med');
    expect(url.searchParams.get('page')).toBe('2');
    await waitFor(() => expect(urls).toHaveLength(1));
  });
});
