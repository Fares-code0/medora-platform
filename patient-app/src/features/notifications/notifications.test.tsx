import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { Text as RNText } from 'react-native';

import { renderWithProviders } from '@/test/render';

import type { PatientNotification } from './model/types';
import { NotificationsScreen } from './screens/NotificationsScreen';
import { notificationService } from './service';
import { formatUnreadBadge } from './unread';
import { useUnreadCount } from './useUnreadCount';

/**
 * The notification centre — checklist R-07.
 *
 * Read state is the one value on this screen the client already knows
 * the answer to, so it is the one place an optimistic update is honest.
 * These tests are about what the patient sees between the tap and the
 * response: the badge going immediately, and coming back with an
 * explanation when the write did not land.
 */

const UNREAD: PatientNotification = {
  id: 'NT-A',
  category: 'appointments',
  priority: 'important',
  title: 'Appointment confirmed',
  body: 'The clinic confirmed one of your appointments.',
  createdAt: new Date('2026-09-05T09:00:00Z').toISOString(),
  readAt: null,
  deepLink: null,
};

/**
 * Only the spies this file installs are restored.
 *
 * `jest.restoreAllMocks()` would also undo the ones `src/test/setup.ts`
 * installs for the file — including the reduce-motion spy that holds
 * `useReducedMotion()` in its "unknown, so do not animate" state. Undo
 * that and the next test in this file renders a skeleton whose looping
 * animation outlives it.
 */
// `mock`-prefixed so the factory below may close over it. The screen
// reaches the ROOT navigator through `useNavigation()`, because the
// notification centre lives under Profile and an appointment lives under
// Appointments -- the hand-off crosses tabs.
const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual<object>('@react-navigation/native'),
  useNavigation: () => ({ navigate: (...args: unknown[]) => mockNavigate(...args) }),
}));

const installed: { mockRestore: () => void }[] = [];

function stub<K extends 'list' | 'markRead' | 'markUnread' | 'markAllRead' | 'unreadCount'>(
  method: K,
) {
  const spy = jest.spyOn(notificationService, method);
  installed.push(spy);
  return spy;
}

/** One page, and the last one. */
function page(items: PatientNotification[]) {
  return { items, totalItems: items.length, hasMore: false };
}

function renderNotifications() {
  stub('list').mockResolvedValue(page([UNREAD]));
  return renderWithProviders(<NotificationsScreen />);
}

/**
 * A write the test holds open, so the assertions in between are looking
 * at the optimistic update and nothing else — and then releases, so no
 * mutation is left pending when the test ends.
 */
function heldWrite() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    promise,
    async release() {
      release();
      await act(async () => {
        await promise;
      });
    },
  };
}

afterEach(() => {
  while (installed.length > 0) installed.pop()?.mockRestore();
  mockNavigate.mockClear();
});

describe('marking one read', () => {
  it('drops the unread badge on the tap, not on the response', async () => {
    const write = heldWrite();
    stub('markRead').mockReturnValue(write.promise);
    const { findByTestId, queryByText } = renderNotifications();

    await act(async () => {
      fireEvent.press(await findByTestId('notification-NT-A'));
      await Promise.resolve();
    });

    // The write has not come back yet, so anything visible here is the
    // optimistic update and nothing else.
    await waitFor(() => {
      expect(queryByText('New')).toBeNull();
    });
    expect(queryByText('1 new')).toBeNull();

    await write.release();
  });

  it('puts the badge back and says so when the write fails', async () => {
    stub('markRead').mockRejectedValue(Object.assign(new Error('offline'), { kind: 'network' }));
    const { findByTestId, findByText, queryByText } = renderNotifications();

    await act(async () => {
      fireEvent.press(await findByTestId('notification-NT-A'));
      await Promise.resolve();
    });

    expect(await findByText('That notification could not be marked as read.')).toBeTruthy();
    // The rollback is what makes the message true: a patient told the
    // write failed must not be looking at a row that says it worked.
    await waitFor(() => {
      expect(queryByText('New')).not.toBeNull();
    });
  });
});

describe('marking all read', () => {
  it('clears every badge immediately', async () => {
    const write = heldWrite();
    stub('markAllRead').mockReturnValue(write.promise);
    const { findByTestId, queryByText } = renderNotifications();

    await act(async () => {
      fireEvent.press(await findByTestId('notifications-mark-all'));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(queryByText('New')).toBeNull();
    });

    await write.release();
  });

  it('restores them and explains when the write fails', async () => {
    stub('markAllRead').mockRejectedValue(Object.assign(new Error('offline'), { kind: 'network' }));
    const { findByTestId, findByText, queryByText } = renderNotifications();

    await act(async () => {
      fireEvent.press(await findByTestId('notifications-mark-all'));
      await Promise.resolve();
    });

    expect(await findByText('Your notifications could not be marked as read.')).toBeTruthy();
    await waitFor(() => {
      expect(queryByText('New')).not.toBeNull();
    });
  });
});

/**
 * The tab-bar badge (O-02) reads a different query from this screen, so
 * a read here has to reach it. These are the two halves of that: it is
 * told on success, and it is NOT told on failure — the badge was never
 * optimistically moved, so the count it shows is still the server's.
 */
describe('keeping the tab-bar badge honest (O-02)', () => {
  /**
   * `AppTabs` holds a live observer on the count. Mounting one beside
   * the screen is what makes an invalidation observable as a refetch —
   * `invalidateQueries` only re-fetches queries something is watching,
   * so a test without an observer would pass on a marked-stale query
   * that never actually reloads.
   */
  function BadgeProbe() {
    const { count } = useUnreadCount();
    return <RNText testID="badge-probe">{formatUnreadBadge(count) ?? 'none'}</RNText>;
  }

  function renderWithBadge(count: number) {
    const badge = stub('unreadCount').mockResolvedValue(count);
    stub('list').mockResolvedValue(page([UNREAD]));
    return {
      badge,
      ...renderWithProviders(
        <>
          <NotificationsScreen />
          <BadgeProbe />
        </>,
      ),
    };
  }

  it('re-reads the count after a notification is marked read', async () => {
    const { badge, findByTestId } = renderWithBadge(1);
    stub('markRead').mockResolvedValue(undefined);

    await waitFor(() => expect(badge).toHaveBeenCalledTimes(1));

    fireEvent.press(await findByTestId('notification-NT-A'));

    await waitFor(() => expect(badge).toHaveBeenCalledTimes(2));
  });

  it('leaves it alone when the write fails', async () => {
    const { badge, findByTestId, findByText } = renderWithBadge(1);
    stub('markRead').mockRejectedValue(Object.assign(new Error('offline'), { kind: 'network' }));

    await waitFor(() => expect(badge).toHaveBeenCalledTimes(1));

    fireEvent.press(await findByTestId('notification-NT-A'));
    expect(await findByText('That notification could not be marked as read.')).toBeTruthy();

    // Still the one initial read. The badge was never optimistically
    // moved, so a refetch would spend a request to learn a number that
    // cannot have changed.
    expect(badge).toHaveBeenCalledTimes(1);
  });

  it('draws no badge while the count is zero', async () => {
    const { badge, findByTestId } = renderWithBadge(0);
    stub('markRead').mockResolvedValue(undefined);

    await waitFor(() => expect(badge).toHaveBeenCalled());
    expect((await findByTestId('badge-probe')).children).toEqual(['none']);
  });
});

/**
 * Paging — the half of O-01 the feed was missing.
 *
 * `unreadCount` already read the badge endpoint rather than counting the
 * feed, and said why: "the feed is one page of twenty, so counting it
 * would under-report the badge as soon as a patient had more than a page
 * of notifications." The feed itself had no such compensation. It read
 * page one and stopped, so past twenty rows the tab badge could show a
 * number larger than anything reachable on screen.
 */
describe('a feed longer than one page (O-01)', () => {
  function unread(id: string): PatientNotification {
    return { ...UNREAD, id };
  }

  /** Two pages of one notification each, keyed by page number. */
  function twoPages() {
    return stub('list').mockImplementation(async (page = 1) =>
      page === 1
        ? { items: [unread('NT-A')], totalItems: 2, hasMore: true }
        : { items: [unread('NT-B')], totalItems: 2, hasMore: false },
    );
  }

  it('offers Show more when the server says there is another page', async () => {
    twoPages();
    const { findByTestId, queryByTestId } = renderWithProviders(<NotificationsScreen />);

    expect(await findByTestId('notifications-load-more')).toBeTruthy();
    expect(queryByTestId('notifications-end')).toBeNull();
  });

  it('appends the next page rather than replacing the one being read', async () => {
    const list = twoPages();
    const { findByTestId, getByTestId } = renderWithProviders(<NotificationsScreen />);

    await act(async () => {
      fireEvent.press(await findByTestId('notifications-load-more'));
    });

    expect(await findByTestId('notification-NT-B')).toBeTruthy();
    expect(getByTestId('notification-NT-A')).toBeTruthy();
    expect(list).toHaveBeenCalledWith(2);
  });

  it('leaves a single-page feed undecorated', async () => {
    stub('list').mockResolvedValue(page([unread('NT-A')]));
    const { findByTestId, queryByTestId } = renderWithProviders(<NotificationsScreen />);

    await findByTestId('notification-NT-A');
    expect(queryByTestId('notifications-load-more')).toBeNull();
    expect(queryByTestId('notifications-end')).toBeNull();
  });

  it('marks all read across every page loaded, not just the newest', async () => {
    // The badge counts every unread row the caller has, so "mark all
    // read" has to reach page two as well. A rewrite scoped to the
    // newest page would leave rows on screen still showing New after
    // the count had gone to zero.
    //
    // The write is held open deliberately. `optimisticUpdate` re-fetches
    // on settle either way (step 3b), and a refetch would repaint both
    // pages from the server -- so an assertion made after the write
    // resolved would pass whether the optimistic rewrite reached page
    // two or not. Held open, what is on screen is the rewrite and
    // nothing else.
    twoPages();
    let release = () => {};
    stub('markAllRead').mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const { findByTestId, queryAllByText } = renderWithProviders(<NotificationsScreen />);

    await act(async () => {
      fireEvent.press(await findByTestId('notifications-load-more'));
    });
    await findByTestId('notification-NT-B');
    expect(queryAllByText('New')).toHaveLength(2);

    await act(async () => {
      fireEvent.press(await findByTestId('notifications-mark-all'));
      await Promise.resolve();
    });

    // Both pages, while the server has said nothing yet. `waitFor`
    // rather than a bare assertion because `onMutate` awaits
    // `cancelQueries` before it rewrites -- and with the write held
    // open there is no refetch that could clear these instead.
    await waitFor(() => expect(queryAllByText('New')).toHaveLength(0));

    await act(async () => {
      release();
    });
  });

  it('marks one row read without disturbing the other page', async () => {
    twoPages();
    stub('markRead').mockResolvedValue(undefined);
    const { findByTestId, getByTestId } = renderWithProviders(<NotificationsScreen />);

    await act(async () => {
      fireEvent.press(await findByTestId('notifications-load-more'));
    });
    await findByTestId('notification-NT-B');

    await act(async () => {
      fireEvent.press(getByTestId('notification-NT-A'));
    });

    // Page two is still on screen and still unread. An optimistic
    // rewrite that rebuilt the cache from the mutated page would have
    // dropped it.
    await waitFor(() => expect(getByTestId('notification-NT-B')).toBeTruthy());
  });
});

/**
 * Tapping a notification goes somewhere — checklist O-04, in-app half.
 *
 * The adapter has built a `deepLink` for every appointment notification
 * since O-01 landed and nothing read it, so "Your appointment was
 * confirmed" was a statement with no way to act on it. Worse, the tap
 * that acknowledged it was the tap that lost it: the row stopped being
 * marked New and the patient had nowhere to go from there.
 *
 * `deep-link.test.ts` owns what may and may not be opened. These are
 * about the screen: that it navigates, that it still marks read either
 * way, and that a screen reader is told which of the two a given row
 * will do.
 */
describe('tapping a notification (O-04)', () => {
  const LINKED: PatientNotification = {
    ...UNREAD,
    id: 'NT-LINK',
    deepLink: 'medora://appointments/APT-3007',
  };

  it('opens the appointment a linked notification points at', async () => {
    stub('list').mockResolvedValue(page([LINKED]));
    stub('markRead').mockResolvedValue(undefined);
    const { findByTestId } = renderWithProviders(<NotificationsScreen />);

    await act(async () => {
      fireEvent.press(await findByTestId('notification-NT-LINK'));
    });

    expect(mockNavigate).toHaveBeenCalledWith('Tabs', {
      screen: 'AppointmentsTab',
      params: { screen: 'AppointmentDetail', params: { appointmentId: 'APT-3007' } },
    });
  });

  it('still marks it read on the way', async () => {
    stub('list').mockResolvedValue(page([LINKED]));
    const markRead = stub('markRead').mockResolvedValue(undefined);
    const { findByTestId } = renderWithProviders(<NotificationsScreen />);

    await act(async () => {
      fireEvent.press(await findByTestId('notification-NT-LINK'));
    });

    expect(markRead).toHaveBeenCalledWith('NT-LINK');
  });

  it('opens an already-read notification too', async () => {
    // Read is not dismissed. A patient who read "your appointment was
    // rescheduled" yesterday and wants to see the new time taps the
    // same row.
    stub('list').mockResolvedValue(page([{ ...LINKED, readAt: '2026-09-08T10:00:00.000Z' }]));
    const markRead = stub('markRead').mockResolvedValue(undefined);
    const { findByTestId } = renderWithProviders(<NotificationsScreen />);

    await act(async () => {
      fireEvent.press(await findByTestId('notification-NT-LINK'));
    });

    expect(mockNavigate).toHaveBeenCalled();
    // Marking an already-read row read again would be a request that
    // cannot change anything.
    expect(markRead).not.toHaveBeenCalled();
  });

  it('goes nowhere for a notification that points nowhere', async () => {
    stub('list').mockResolvedValue(page([UNREAD]));
    stub('markRead').mockResolvedValue(undefined);
    const { findByTestId } = renderWithProviders(<NotificationsScreen />);

    await act(async () => {
      fireEvent.press(await findByTestId('notification-NT-A'));
    });

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('does not follow a link on a scheme this app does not own', async () => {
    // Server-supplied text. A payload carrying an off-scheme link is a
    // defect somewhere, and the client's part is to not act on it.
    stub('list').mockResolvedValue(
      page([{ ...LINKED, deepLink: 'https://example.test/appointments/APT-1' }]),
    );
    stub('markRead').mockResolvedValue(undefined);
    const { findByTestId } = renderWithProviders(<NotificationsScreen />);

    await act(async () => {
      fireEvent.press(await findByTestId('notification-NT-LINK'));
    });

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('tells a screen reader which of the two the tap will do', async () => {
    stub('list').mockResolvedValue(page([LINKED, UNREAD]));
    stub('markRead').mockResolvedValue(undefined);
    const { findByTestId, getByTestId } = renderWithProviders(<NotificationsScreen />);

    const linked = await findByTestId('notification-NT-LINK');
    expect(String(linked.props.accessibilityHint)).toContain('opens the appointment');
    // The unlinked row keeps the hint it had: this tap only marks read,
    // and promising an appointment it will not open would be worse than
    // saying nothing.
    expect(String(getByTestId('notification-NT-A').props.accessibilityHint)).toBe(
      'Marks it as read',
    );
  });
});

/**
 * Putting a row back to unread — checklist O-01.
 *
 * `POST /notifications/{id}/unread` has been live since the feed was and
 * the port did not name it, so `notificationEndpoints.markUnread` was
 * unreachable code. It matters more since O-04: opening an appointment
 * from a notification marks the notification read as a side effect, so a
 * patient acting on "your appointment was rescheduled" loses the flag by
 * doing the thing the notification asked them to do.
 */
describe('marking one unread (O-01)', () => {
  const READ: PatientNotification = {
    ...UNREAD,
    id: 'NT-READ',
    readAt: '2026-09-08T10:00:00.000Z',
  };

  it('offers the undo on a read row and not on an unread one', async () => {
    stub('list').mockResolvedValue(page([READ, UNREAD]));
    const { findByTestId, queryByTestId } = renderWithProviders(<NotificationsScreen />);

    expect(await findByTestId('notification-NT-READ-mark-unread')).toBeTruthy();
    // On an unread row it would be a no-op with a label that promised
    // something, and a request that cannot change anything.
    expect(queryByTestId('notification-NT-A-mark-unread')).toBeNull();
  });

  it('restores the New badge on the tap, not on the response', async () => {
    stub('list').mockResolvedValue(page([READ]));
    let release = () => {};
    stub('markUnread').mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const { findByTestId, queryAllByText } = renderWithProviders(<NotificationsScreen />);

    expect(queryAllByText('New')).toHaveLength(0);

    await act(async () => {
      fireEvent.press(await findByTestId('notification-NT-READ-mark-unread'));
    });

    // Held open, so this is the optimistic rewrite and not a refetch.
    await waitFor(() => expect(queryAllByText('New')).toHaveLength(1));

    await act(async () => {
      release();
    });
  });

  it('calls the live route with the row id', async () => {
    stub('list').mockResolvedValue(page([READ]));
    const markUnread = stub('markUnread').mockResolvedValue(undefined);
    const { findByTestId } = renderWithProviders(<NotificationsScreen />);

    await act(async () => {
      fireEvent.press(await findByTestId('notification-NT-READ-mark-unread'));
    });

    expect(markUnread).toHaveBeenCalledWith('NT-READ');
  });

  it('puts it back and says so when the write fails', async () => {
    stub('list').mockResolvedValue(page([READ]));
    stub('markUnread').mockRejectedValue(Object.assign(new Error('offline'), { kind: 'network' }));
    const { findByTestId, findByText, queryAllByText } = renderWithProviders(
      <NotificationsScreen />,
    );

    await act(async () => {
      fireEvent.press(await findByTestId('notification-NT-READ-mark-unread'));
    });

    expect(await findByText('That notification could not be marked as unread.')).toBeTruthy();
    // A silent rollback is a patient who believes a notification is
    // waiting for them when it is not.
    await waitFor(() => expect(queryAllByText('New')).toHaveLength(0));
  });

  it('does not navigate — the undo is about the flag, not about going anywhere', async () => {
    stub('list').mockResolvedValue(page([{ ...READ, deepLink: 'medora://appointments/APT-3007' }]));
    stub('markUnread').mockResolvedValue(undefined);
    const { findByTestId } = renderWithProviders(<NotificationsScreen />);

    await act(async () => {
      fireEvent.press(await findByTestId('notification-NT-READ-mark-unread'));
    });

    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
