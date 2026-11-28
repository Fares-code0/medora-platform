import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Text as RNText } from 'react-native';

import type { RootStackParamList } from '@/navigation/routes';
import { renderWithProviders } from '@/test/render';

import { BookingFlow } from './booking/BookingFlow';
import { resetAppointmentFixtures } from './fixtures/appointment-fixtures';
import { appointmentService } from './service';

/**
 * Booking against the real contract's failure modes (ADR-049): a taken
 * slot, an uncovered insurance plan, a lost connection, a double tap —
 * and the Idempotency-Key that makes a retry safe.
 */

const Stack = createNativeStackNavigator<RootStackParamList>();

function TabsStub() {
  return <RNText testID="tabs-stub">tabs</RNText>;
}

let queryClient: QueryClient | null = null;

function renderBooking() {
  const rendered = renderWithProviders(
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Booking" component={BookingFlow} />
        <Stack.Screen name="Tabs" component={TabsStub} />
      </Stack.Navigator>
    </NavigationContainer>,
  );
  queryClient = rendered.queryClient;
  return rendered;
}

function apiError(kind: string, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(`API error: ${kind}`), { kind, ...extra });
}

async function walkToConfirm(reason = 'Ongoing chest pain') {
  fireEvent.press((await screen.findAllByTestId(/^booking-doctor-/))[0]);
  fireEvent.press(await screen.findByTestId('booking-to-time'));
  fireEvent.press((await screen.findAllByTestId(/^booking-slot-/))[0]);
  fireEvent.press(screen.getByTestId('booking-to-reason'));
  fireEvent.changeText(await screen.findByTestId('booking-reason'), reason);
  fireEvent.press(screen.getByTestId('booking-to-confirm'));
  await screen.findByTestId('booking-submit');
}

beforeEach(() => resetAppointmentFixtures());
afterEach(() => {
  jest.restoreAllMocks();
  queryClient?.unmount();
  queryClient?.clear();
  queryClient = null;
});

describe('the confirm step', () => {
  it('names the hospital the time is at', async () => {
    renderBooking();
    await walkToConfirm();

    expect(screen.getByTestId('booking-confirm-hospital').props.children).toBe('Medora Clinic');
  });
});

describe('a slot that was taken', () => {
  it('returns to the time step with the reason kept, and says so', async () => {
    jest
      .spyOn(appointmentService, 'book')
      .mockRejectedValueOnce(apiError('conflict', { code: 'slot_taken', detail: 'taken' }));
    renderBooking();
    await walkToConfirm('A reason worth keeping');

    await act(async () => {
      fireEvent.press(screen.getByTestId('booking-submit'));
    });

    expect(await screen.findByText(/Someone else booked that time/)).toBeTruthy();
    expect(screen.getByText('Step 3 of 5')).toBeTruthy();
    // The patient chose nothing new yet, but nothing they wrote is gone.
    fireEvent.press((await screen.findAllByTestId(/^booking-slot-/))[1]);
    fireEvent.press(screen.getByTestId('booking-to-reason'));
    expect(screen.getByTestId('booking-reason').props.value).toBe('A reason worth keeping');
  });
});

describe('insurance not covered (422)', () => {
  it('stays on Confirm and shows the server’s detail', async () => {
    jest.spyOn(appointmentService, 'book').mockRejectedValueOnce(
      apiError('validation', {
        code: 'insurance_not_covered',
        fieldErrors: {},
        detail: 'Plan X is not accepted at this hospital.',
      }),
    );
    renderBooking();
    await walkToConfirm();

    await act(async () => {
      fireEvent.press(screen.getByTestId('booking-submit'));
    });

    expect(await screen.findByText(/does not cover this booking/)).toBeTruthy();
    expect(screen.getByText('Plan X is not accepted at this hospital.')).toBeTruthy();
    expect(screen.getByText('Step 5 of 5')).toBeTruthy();
    expect(screen.getByTestId('booking-submit')).toBeTruthy();
  });
});

describe('an account that is not linked', () => {
  it('says so and offers the link screen', async () => {
    jest
      .spyOn(appointmentService, 'book')
      .mockRejectedValueOnce(apiError('conflict', { code: 'patient_not_linked', detail: 'x' }));
    renderBooking();
    await walkToConfirm();

    await act(async () => {
      fireEvent.press(screen.getByTestId('booking-submit'));
    });

    expect(await screen.findByText(/not linked to a patient record/)).toBeTruthy();
    expect(screen.getByTestId('booking-failure-link')).toBeTruthy();
  });
});

describe('a lost connection', () => {
  it('keeps the form, and the retry re-sends the SAME Idempotency-Key', async () => {
    const book = jest.spyOn(appointmentService, 'book').mockRejectedValueOnce(apiError('network'));
    renderBooking();
    await walkToConfirm();

    await act(async () => {
      fireEvent.press(screen.getByTestId('booking-submit'));
    });
    expect(await screen.findByText(/could not be reached/)).toBeTruthy();
    expect(screen.getByText('Step 5 of 5')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByTestId('booking-submit'));
    });
    await waitFor(() => expect(book).toHaveBeenCalledTimes(2));
    expect(book.mock.calls[0]?.[1]).toBeTruthy();
    expect(book.mock.calls[1]?.[1]).toBe(book.mock.calls[0]?.[1]);
    await waitFor(() => expect(screen.getByTestId('tabs-stub')).toBeTruthy());
  });

  it('uses a NEW key once the outcome was a definite refusal', async () => {
    const book = jest
      .spyOn(appointmentService, 'book')
      .mockRejectedValueOnce(
        apiError('validation', { code: 'insurance_not_covered', fieldErrors: {} }),
      );
    renderBooking();
    await walkToConfirm();

    await act(async () => {
      fireEvent.press(screen.getByTestId('booking-submit'));
    });
    await screen.findByText(/does not cover this booking/);
    await act(async () => {
      fireEvent.press(screen.getByTestId('booking-submit'));
    });

    await waitFor(() => expect(book).toHaveBeenCalledTimes(2));
    expect(book.mock.calls[1]?.[1]).not.toBe(book.mock.calls[0]?.[1]);
  });
});

describe('a double tap', () => {
  it('sends one request', async () => {
    let finish: (value: never) => void = () => undefined;
    const book = jest.spyOn(appointmentService, 'book').mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    renderBooking();
    await walkToConfirm();

    await act(async () => {
      fireEvent.press(screen.getByTestId('booking-submit'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('booking-submit'));
    });
    expect(book).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('booking-submit').props.accessibilityState.busy).toBe(true);

    await act(async () => {
      finish({ id: 'APT-1' } as never);
    });
  });
});
