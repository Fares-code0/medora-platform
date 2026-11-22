import { useEffect, useState } from 'react';

import { fireEvent } from '@testing-library/react-native';
import { KeyboardAvoidingView } from 'react-native';

import { normalizeHttpError } from '@/api/errors';
import { EndpointNotImplementedError } from '@/api/seam';
import { ar, en } from '@/i18n/messages';
import { ResponseContractError } from '@/schemas/envelope';
import { renderWithProviders } from '@/test/render';
import { MIN_TOUCH_TARGET } from '@/theme';
import { APPOINTMENT_STATUSES } from '@/types/vocabularies';

import { initialsOf } from './Avatar';
import { Button } from './Button';
import { Chip } from './Chip';
import { ConfirmSheet } from './ConfirmSheet';
import { AsyncBoundary } from './feedback/AsyncBoundary';
import { EmptyState } from './feedback/EmptyState';
import { ErrorState, __presentForTest } from './feedback/ErrorState';
import { Input } from './Input';
import { BottomSheet } from './layout/BottomSheet';
import { StatusBadge, statusPresentation } from './StatusBadge';
import { Text } from './Text';

/**
 * Design-system tests.
 *
 * Rendering, interaction and accessibility for each primitive — the three
 * axes checklist U-04 and U-09 ask for. The accessibility assertions are
 * real assertions on roles and labels, not a note that somebody looked.
 */

function flattenStyle(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) {
    return style.reduce<Record<string, unknown>>(
      (acc, entry) => ({ ...acc, ...flattenStyle(entry) }),
      {},
    );
  }
  return (style ?? {}) as Record<string, unknown>;
}

describe('Button', () => {
  it('renders its label and fires onPress', () => {
    const onPress = jest.fn();
    const { getByTestId, getByText } = renderWithProviders(
      <Button label="Book" onPress={onPress} testID="btn" />,
    );

    expect(getByText('Book')).toBeTruthy();
    fireEvent.press(getByTestId('btn'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('exposes a button role and its label to assistive technology', () => {
    const { getByTestId } = renderWithProviders(
      <Button label="Book" hint="Opens the booking flow" onPress={jest.fn()} testID="btn" />,
    );
    const button = getByTestId('btn');

    expect(button.props.accessibilityRole).toBe('button');
    expect(button.props.accessibilityLabel).toBe('Book');
    expect(button.props.accessibilityHint).toBe('Opens the booking flow');
  });

  it('clears the 44dp touch floor at every size (S-01)', () => {
    for (const size of ['sm', 'md', 'lg'] as const) {
      const { getByTestId } = renderWithProviders(
        <Button label="X" size={size} onPress={jest.fn()} testID={`btn-${size}`} />,
      );
      const style = flattenStyle(getByTestId(`btn-${size}`).props.style);
      expect(style.minHeight as number).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
    }
  });

  it('does not fire while disabled, and says so', () => {
    const onPress = jest.fn();
    const { getByTestId } = renderWithProviders(
      <Button label="Book" disabled onPress={onPress} testID="btn" />,
    );

    fireEvent.press(getByTestId('btn'));
    expect(onPress).not.toHaveBeenCalled();
    expect(getByTestId('btn').props.accessibilityState.disabled).toBe(true);
  });

  it('does not fire while loading, and announces busy', () => {
    const onPress = jest.fn();
    const { getByTestId } = renderWithProviders(
      <Button label="Book" loading onPress={onPress} testID="btn" />,
    );

    fireEvent.press(getByTestId('btn'));
    expect(onPress).not.toHaveBeenCalled();
    expect(getByTestId('btn').props.accessibilityState.busy).toBe(true);
  });

  it('renders in the dark theme too', () => {
    const { getByText } = renderWithProviders(<Button label="Book" onPress={jest.fn()} />, {
      mode: 'dark',
    });
    expect(getByText('Book')).toBeTruthy();
  });
});

describe('Input', () => {
  it('reports its value changes', () => {
    const onChangeText = jest.fn();
    const { getByTestId } = renderWithProviders(
      <Input label="Email" value="" onChangeText={onChangeText} testID="email" />,
    );

    fireEvent.changeText(getByTestId('email'), 'sara@example.com');
    expect(onChangeText).toHaveBeenCalledWith('sara@example.com');
  });

  it('marks a required field in its accessible label', () => {
    const { getByTestId } = renderWithProviders(
      <Input label="Email" value="" onChangeText={jest.fn()} required testID="email" />,
    );
    expect(getByTestId('email').props.accessibilityLabel).toBe('Email, required');
  });

  it('renders an error as text as well as colour (WCAG 1.4.1)', () => {
    const { getByText } = renderWithProviders(
      <Input label="Email" value="" onChangeText={jest.fn()} error="Enter a valid email address" />,
    );
    expect(getByText('Enter a valid email address')).toBeTruthy();
  });

  it('does not accept input while disabled', () => {
    const { getByTestId } = renderWithProviders(
      <Input label="Email" value="" onChangeText={jest.fn()} disabled testID="email" />,
    );
    expect(getByTestId('email').props.editable).toBe(false);
  });

  it('offers a labelled reveal control for a password', () => {
    const { getByLabelText } = renderWithProviders(
      <Input label="Password" value="x" onChangeText={jest.fn()} secure testID="pw" />,
    );
    expect(getByLabelText('Show password')).toBeTruthy();
  });

  it('labels the password toggle in Arabic as well as English', () => {
    const view = renderWithProviders(<Input label="x" value="x" onChangeText={jest.fn()} secure />, {
      locale: 'ar',
    });
    const toggle = view.getByLabelText(ar['a11y.password.show']);
    expect(toggle.props.accessibilityLabel).toBe('إظهار كلمة المرور');
    expect(view.queryByLabelText('Show password')).toBeNull();
    fireEvent.press(toggle);
    expect(view.getByLabelText(ar['a11y.password.hide'])).toBeTruthy();
    expect(en['a11y.password.show']).toBe('Show password');
  });

  it('hides the password until the patient asks, and says which state it is in', () => {
    // Both halves matter. `secureTextEntry` is what keeps a password off
    // a shoulder-surfer's screen and off the OS keyboard's suggestion
    // strip; the label is what tells a screen-reader user which way the
    // control is about to go, and a control whose label does not change
    // with its state is a toggle nobody can follow.
    const view = renderWithProviders(
      <Input label="Password" value="hunter2" onChangeText={jest.fn()} secure testID="pw" />,
    );

    expect(view.getByTestId('pw').props.secureTextEntry).toBe(true);

    fireEvent.press(view.getByLabelText('Show password'));

    expect(view.getByTestId('pw').props.secureTextEntry).toBe(false);
    expect(view.getByLabelText('Hide password')).toBeTruthy();

    fireEvent.press(view.getByLabelText('Hide password'));

    expect(view.getByTestId('pw').props.secureTextEntry).toBe(true);
  });

  it('has no reveal control on a field that is not a password', () => {
    const view = renderWithProviders(
      <Input label="Email" value="" onChangeText={jest.fn()} testID="email" />,
    );

    expect(view.queryByLabelText('Show password')).toBeNull();
    expect(view.getByTestId('email').props.secureTextEntry).toBeFalsy();
  });
});

describe('Chip', () => {
  it('carries selection in the accessibility state, not only in colour', () => {
    const { getByTestId } = renderWithProviders(
      <Chip label="Cardiology" selected onPress={jest.fn()} testID="chip" />,
    );
    expect(getByTestId('chip').props.accessibilityState.selected).toBe(true);
  });
});

describe('Avatar', () => {
  it('derives initials, and copes with an empty name', () => {
    expect(initialsOf('Sara Ahmed')).toBe('SA');
    expect(initialsOf('Layla')).toBe('L');
    expect(initialsOf('  ')).toBe('?');
  });
});

describe('StatusBadge', () => {
  it('maps all eight appointment statuses to distinct copy (C-08)', () => {
    const keys = APPOINTMENT_STATUSES.map((status) => statusPresentation(status).labelKey);

    for (const key of keys) {
      expect(en[key].length).toBeGreaterThan(0);
    }
    // Distinct as keys, so two statuses cannot read alike in any
    // language — the failure that matters is a patient who cannot tell
    // "Cancelled" from "Missed".
    expect(new Set(keys).size).toBe(APPOINTMENT_STATUSES.length);
  });

  it('renders a patient-facing label, not the database literal', () => {
    const { getByText, queryByText } = renderWithProviders(
      <StatusBadge status="awaiting-patient" />,
    );
    expect(getByText('Needs your response')).toBeTruthy();
    expect(queryByText('awaiting-patient')).toBeNull();
  });

  it('renders the literal in no language at all', () => {
    const { queryByText } = renderWithProviders(<StatusBadge status="awaiting-patient" />, {
      locale: 'ar',
    });
    expect(queryByText('awaiting-patient')).toBeNull();
  });

  it('gives no-show its own distinct wording', () => {
    const { getByText } = renderWithProviders(<StatusBadge status="no-show" />);
    expect(getByText('Missed')).toBeTruthy();
  });
});

describe('EmptyState', () => {
  it('offers a next action when one is given (R-02)', () => {
    const onPress = jest.fn();
    const { getByText } = renderWithProviders(
      <EmptyState title="Nothing booked" action={{ label: 'Book', onPress }} />,
    );

    fireEvent.press(getByText('Book'));
    expect(onPress).toHaveBeenCalled();
  });
});

describe('ErrorState', () => {
  it('gives each error kind distinct copy (R-03)', () => {
    // Compared as catalogue keys rather than as rendered English: two
    // kinds that share a key share a sentence in EVERY language, which is
    // the thing this row cares about. Comparing sentences would only ever
    // check whichever locale the test happened to render in.
    const titles = [
      __presentForTest({ kind: 'network' }),
      __presentForTest({ kind: 'timeout' }),
      __presentForTest({ kind: 'auth' }),
      __presentForTest({ kind: 'forbidden' }),
      __presentForTest({ kind: 'not_found' }),
      __presentForTest({ kind: 'conflict', detail: 'x' }),
      __presentForTest({ kind: 'rate_limited', retryAfterSeconds: 30 }),
      __presentForTest({ kind: 'validation', fieldErrors: {} }),
      __presentForTest({ kind: 'server', ref: 'HTTP-500' }),
    ].map((presentation) => presentation.titleKey);

    // Keys rather than sentences since C-09: the claim is the same one —
    // no two kinds read alike — and a key comparison also catches two
    // kinds that share a catalogue entry, which two identical sentences
    // written twice would not.
    expect(new Set(titles).size).toBe(titles.length);
  });

  it('renders the catalogue, not inline English (C-09)', () => {
    const { getByText } = renderWithProviders(<ErrorState error={{ kind: 'timeout' }} />, {
      locale: 'ar',
    });

    expect(getByText(ar['state.error.timeout.title'])).toBeTruthy();
    expect(getByText(ar['state.error.timeout.body'])).toBeTruthy();
  });

  it('interpolates the values it is allowed to render, and only those', () => {
    const { getByText } = renderWithProviders(
      <ErrorState error={{ kind: 'rate_limited', retryAfterSeconds: 30 }} />,
    );

    // The countdown and the correlation id are the two server-supplied
    // values this component may show; `detail` and `message` are not.
    expect(getByText(/30 seconds/)).toBeTruthy();
  });

  it('offers Retry only where retrying can work', () => {
    const retryable = renderWithProviders(
      <ErrorState error={{ kind: 'network' }} onRetry={jest.fn()} testID="err" />,
    );
    expect(retryable.getByTestId('err-retry')).toBeTruthy();

    const notRetryable = renderWithProviders(
      <ErrorState error={{ kind: 'forbidden' }} onRetry={jest.fn()} testID="err2" />,
    );
    expect(notRetryable.queryByTestId('err2-retry')).toBeNull();
  });

  it('says a capability is not built yet rather than showing a failure', () => {
    const { getByText } = renderWithProviders(
      <ErrorState error={new EndpointNotImplementedError('BE-05', 'capability.booking')} />,
    );
    expect(getByText('Not available yet')).toBeTruthy();
  });

  it('never renders the server detail string (it can carry PHI)', () => {
    const { queryByText } = renderWithProviders(
      <ErrorState error={{ kind: 'conflict', detail: 'Sara Ahmed changed this' }} />,
    );
    expect(queryByText(/Sara Ahmed/)).toBeNull();
  });
});

describe('AsyncBoundary', () => {
  const base = { data: undefined, isPending: false, isError: false, error: null };

  it('shows the loading state first', () => {
    const { getByTestId } = renderWithProviders(
      <AsyncBoundary query={{ ...base, isPending: true }} testID="b">
        {() => null}
      </AsyncBoundary>,
    );
    expect(getByTestId('b-loading')).toBeTruthy();
  });

  it('shows the error state ahead of a refetch skeleton', () => {
    const { getByTestId } = renderWithProviders(
      <AsyncBoundary
        query={{ ...base, isPending: true, isError: true, error: { kind: 'network' } }}
        testID="b"
      >
        {() => null}
      </AsyncBoundary>,
    );
    expect(getByTestId('b-error')).toBeTruthy();
  });

  it('shows the empty state for an empty collection', () => {
    const { getByTestId } = renderWithProviders(
      <AsyncBoundary
        query={{ ...base, data: [] as string[] }}
        isEmpty={(data) => data.length === 0}
        empty={{ title: 'Nothing here' }}
        testID="b"
      >
        {() => null}
      </AsyncBoundary>,
    );
    expect(getByTestId('b-empty')).toBeTruthy();
  });

  it('renders children once there is data', () => {
    const { getByText } = renderWithProviders(
      <AsyncBoundary query={{ ...base, data: ['x'] }} isEmpty={(d) => d.length === 0}>
        {(data) => <Text>{`got ${data.length}`}</Text>}
      </AsyncBoundary>,
    );
    expect(getByText('got 1')).toBeTruthy();
  });
});

describe('AsyncBoundary — a refresh that fails over cached data', () => {
  const cached = { data: ['x'], isPending: false, isError: true };
  const NETWORK = { kind: 'network' } as const;

  const render = (
    query: { data: string[] | undefined; isPending: boolean; isError: boolean; error: unknown },
    keep = true,
  ) =>
    renderWithProviders(
      <AsyncBoundary
        query={{ ...query, refetch: jest.fn() }}
        isEmpty={(d) => d.length === 0}
        testID="b"
        keepDataOnRefreshError={keep}
      >
        {(data) => <Text>{`got ${data.length}`}</Text>}
      </AsyncBoundary>,
    );

  it('keeps the records on screen and reports the failure in a toast', async () => {
    const view = render({ ...cached, error: NETWORK });

    expect(view.getByText('got 1')).toBeTruthy();
    expect(view.queryByTestId('b-error')).toBeNull();
    expect(await view.findByText(en['state.error.network.title'])).toBeTruthy();
  });

  it('reports one failure once, however often the screen re-renders', async () => {
    const view = render({ ...cached, error: NETWORK });
    await view.findByText(en['state.error.network.title']);

    view.rerender(
      <AsyncBoundary query={{ ...cached, error: NETWORK }} testID="b" keepDataOnRefreshError>
        {(data) => <Text>{`got ${data.length}`}</Text>}
      </AsyncBoundary>,
    );

    expect(view.getAllByText(en['state.error.network.title'])).toHaveLength(1);
  });

  it('still replaces the records when the server now refuses them', () => {
    // Forbidden is not a hiccup: a record the server will no longer show
    // this patient is not one to keep on their screen.
    const view = render({ ...cached, error: { kind: 'forbidden' } });

    expect(view.getByTestId('b-error')).toBeTruthy();
    expect(view.queryByText('got 1')).toBeNull();
  });

  it('shows the full error, with Retry, when a first load fails with nothing cached', () => {
    const view = render({ data: undefined, isPending: false, isError: true, error: NETWORK });

    expect(view.getByTestId('b-error')).toBeTruthy();
    expect(view.getByTestId('b-error-retry')).toBeTruthy();
  });

  it('is opt-in: without the prop a failed refresh shows the error as before', () => {
    const view = render({ ...cached, error: NETWORK }, false);

    expect(view.getByTestId('b-error')).toBeTruthy();
    expect(view.queryByText('got 1')).toBeNull();
  });

  it('never remounts the content when a refresh fails and then recovers', async () => {
    // The content is a stateful component with a mount counter. A text
    // assertion alone passes even when React tears the subtree down and
    // builds a fresh one — which is exactly the defect: the notice placed
    // ahead of the content shifted it one position and lost its state.
    let mounts = 0;
    let unmounts = 0;
    function Counter() {
      const [count, setCount] = useState(0);
      useEffect(() => {
        mounts += 1;
        return () => {
          unmounts += 1;
        };
      }, []);
      return (
        <Button label={`count ${count}`} onPress={() => setCount((c) => c + 1)} testID="counter" />
      );
    }
    const boundary = (query: { isError: boolean; error: unknown }) => (
      <AsyncBoundary
        query={{ data: ['x'], isPending: false, ...query, refetch: jest.fn() }}
        isEmpty={(d) => d.length === 0}
        testID="b"
        keepDataOnRefreshError
      >
        {() => <Counter />}
      </AsyncBoundary>
    );

    const view = renderWithProviders(boundary({ isError: false, error: null }));
    fireEvent.press(view.getByTestId('counter'));
    fireEvent.press(view.getByTestId('counter'));
    expect(view.getByText('count 2')).toBeTruthy();
    expect(mounts).toBe(1);

    // Refresh fails over the cached record: notice appears, content stays.
    view.rerender(boundary({ isError: true, error: NETWORK }));
    expect(await view.findByText(en['state.error.network.title'])).toBeTruthy();
    expect(view.getByText('count 2')).toBeTruthy();

    // Refresh recovers.
    view.rerender(boundary({ isError: false, error: null }));
    expect(view.getByText('count 2')).toBeTruthy();
    expect(mounts).toBe(1);
    expect(unmounts).toBe(0);
  });

  it('never remounts the empty state across a failing refresh either', () => {
    // A remount builds a new host instance; the same instance across all
    // three renders proves the empty state kept its place in the tree.
    const boundary = (query: { isError: boolean; error: unknown }) => (
      <AsyncBoundary
        query={{ data: [] as string[], isPending: false, ...query }}
        isEmpty={(d) => d.length === 0}
        empty={{ title: 'Nothing here' }}
        testID="b"
        keepDataOnRefreshError
      >
        {() => null}
      </AsyncBoundary>
    );

    const view = renderWithProviders(boundary({ isError: false, error: null }));
    const original = view.getByTestId('b-empty');
    view.rerender(boundary({ isError: true, error: NETWORK }));
    expect(view.getByTestId('b-empty')).toBe(original);
    view.rerender(boundary({ isError: false, error: null }));
    expect(view.getByTestId('b-empty')).toBe(original);
  });
});

describe('AsyncBoundary — which refresh failures keep cached records', () => {
  const httpError = (status: number, headers: Record<string, string> = {}) =>
    normalizeHttpError(new Response(JSON.stringify({}), { status, headers }));

  const renderWith = (error: unknown) =>
    renderWithProviders(
      <AsyncBoundary
        query={{ data: ['x'], isPending: false, isError: true, error, refetch: jest.fn() }}
        isEmpty={(d) => d.length === 0}
        testID="b"
        keepDataOnRefreshError
      >
        {(data) => <Text>{`got ${data.length}`}</Text>}
      </AsyncBoundary>,
    );

  it.each([
    ['network', async () => ({ kind: 'network' as const }), 'state.error.network.title'],
    ['timeout', async () => ({ kind: 'timeout' as const }), 'state.error.timeout.title'],
    ['HTTP 500', () => httpError(500), 'state.error.server.title'],
    ['HTTP 503', () => httpError(503), 'state.error.server.title'],
    [
      'HTTP 429 (no Retry button, but the records are still valid)',
      () => httpError(429, { 'Retry-After': '12' }),
      'state.error.rateLimited.title',
    ],
  ] as const)('keeps the records and toasts on %s', async (_name, make, titleKey) => {
    const view = renderWith(await make());

    expect(view.getByText('got 1')).toBeTruthy();
    expect(view.queryByTestId('b-error')).toBeNull();
    expect(await view.findByText(en[titleKey])).toBeTruthy();
  });

  it.each([
    ['HTTP 401 (signed out)', () => httpError(401)],
    ['HTTP 403', () => httpError(403)],
    ['HTTP 404', () => httpError(404)],
    ['HTTP 400', () => httpError(400)],
    ['HTTP 409', () => httpError(409)],
    // Statuses `normalizeHttpError` has no case for land on `server` too;
    // they are not a known outage and must not be treated as one.
    ['an unmapped HTTP 405', () => httpError(405)],
    ['an unmapped HTTP 418', () => httpError(418)],
    ['a server error with no status', async () => ({ kind: 'server' as const, ref: 'X' })],
    ['a cancelled request', async () => ({ kind: 'cancelled' as const })],
    [
      'an unavailable endpoint',
      async () => new EndpointNotImplementedError('BE-09', 'capability.booking'),
    ],
    ['a response contract error', async () => new ResponseContractError('GET /x', ['data'])],
    ['an unknown thrown value', async () => new Error('boom')],
  ] as const)('replaces the records with the error on %s', async (_name, make) => {
    const view = renderWith(await make());

    expect(view.getByTestId('b-error')).toBeTruthy();
    expect(view.queryByText('got 1')).toBeNull();
  });

  it('leaves the first load unchanged: a 429 with nothing cached is the full error', async () => {
    const error = await httpError(429);
    const view = renderWithProviders(
      <AsyncBoundary
        query={{ data: undefined, isPending: false, isError: true, error }}
        testID="b"
        keepDataOnRefreshError
      >
        {() => <Text>never</Text>}
      </AsyncBoundary>,
    );

    expect(view.getByTestId('b-error')).toBeTruthy();
  });
});

describe('ConfirmSheet', () => {
  it('confirms and cancels through separate controls (R-06)', () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    const { getByTestId } = renderWithProviders(
      <ConfirmSheet
        visible
        title="Cancel it?"
        detail="This cannot be undone."
        confirmLabel="Yes, cancel"
        onConfirm={onConfirm}
        onCancel={onCancel}
        testID="confirm"
      />,
    );

    fireEvent.press(getByTestId('confirm-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.press(getByTestId('confirm-confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('renders nothing while hidden', () => {
    const { queryByTestId } = renderWithProviders(
      <ConfirmSheet
        visible={false}
        title="Cancel it?"
        detail="This cannot be undone."
        confirmLabel="Yes"
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
        testID="confirm"
      />,
    );
    expect(queryByTestId('confirm-confirm')).toBeNull();
  });
});

describe('BottomSheet', () => {
  it('lifts the sheet clear of the keyboard, so a reason field and Confirm stay visible', () => {
    const { getByTestId, UNSAFE_getByType } = renderWithProviders(
      <BottomSheet visible onClose={jest.fn()} title="Reason" testID="sheet">
        <Input label="Reason" value="" onChangeText={jest.fn()} testID="sheet-input" />
      </BottomSheet>,
    );

    // The jest-expo preset renders as iOS, where the modal window is not
    // resized for the keyboard and padding is what moves the sheet.
    expect(UNSAFE_getByType(KeyboardAvoidingView).props.behavior).toBe('padding');
    expect(getByTestId('sheet-input')).toBeTruthy();
  });
});
