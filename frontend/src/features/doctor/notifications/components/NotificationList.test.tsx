import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { groupNotifications } from '../model/selectors';
import type { DoctorNotification } from '../model/types';

import { NotificationList, type NotificationListProps } from './NotificationList';

/**
 * The compact row: the whole row opens the notification, and neither the
 * checkbox nor the actions menu does — they sit above the row's hit area and
 * stop their own clicks.
 */

function daysAgo(days: number): string {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

function notification(
  id: string,
  title: string,
  overrides: Partial<DoctorNotification> = {},
): DoctorNotification {
  return {
    id,
    title,
    body: `${title} body`,
    category: 'laboratory',
    priority: 'normal',
    kind: 'alert',
    sender: 'Laboratory',
    createdAt: daysAgo(0),
    read: false,
    archived: false,
    favorite: false,
    pinned: false,
    related: {
      patientId: 'PT-1004',
      patientName: null,
      recordId: null,
      labId: null,
      prescriptionId: null,
      appointmentId: null,
    },
    ...overrides,
  };
}

const ROWS = [
  notification('n1', 'Critical result: Hemoglobin', { priority: 'critical' }),
  notification('n2', 'Refill approved', { read: true, createdAt: daysAgo(1), favorite: true }),
];

function renderList(overrides: Partial<NotificationListProps> = {}) {
  const props: NotificationListProps = {
    notifications: ROWS,
    selectedIds: [],
    onSelectionChange: vi.fn(),
    onOpen: vi.fn(),
    onPatch: vi.fn(),
    onDelete: vi.fn(),
    loading: false,
    emptyState: <p>empty</p>,
    ...overrides,
  };
  render(<NotificationList {...props} />);
  return props;
}

describe('a notification row', () => {
  it('opens when its title is clicked', async () => {
    const props = renderList();
    await userEvent.click(screen.getByRole('button', { name: /^Critical result: Hemoglobin/ }));
    expect(props.onOpen).toHaveBeenCalledWith(ROWS[0]);
  });

  it('selects from the checkbox without opening', async () => {
    const props = renderList();
    await userEvent.click(
      screen.getByRole('checkbox', { name: 'Select "Critical result: Hemoglobin"' }),
    );
    expect(props.onSelectionChange).toHaveBeenCalledWith(['n1']);
    expect(props.onOpen).not.toHaveBeenCalled();
  });

  it('opens its actions menu, and acts from it, without opening the notification', async () => {
    const props = renderList();
    await userEvent.click(
      screen.getByRole('button', { name: 'Actions for "Critical result: Hemoglobin"' }),
    );
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Mark as read' }));

    expect(props.onPatch).toHaveBeenCalledWith(['n1'], { read: true });
    expect(props.onOpen).not.toHaveBeenCalled();
  });

  it('shows the priority badge only off normal, and marks unread, starred and the patient', () => {
    renderList();
    const [critical, refill] = screen.getAllByRole('listitem');
    if (!critical || !refill) throw new Error('two rows expected');

    expect(within(critical).getByText('Critical')).toBeInTheDocument();
    expect(within(critical).getByText(/Unread\./)).toBeInTheDocument();
    expect(within(critical).getByText('PT-1004')).toBeInTheDocument();

    expect(within(refill).queryByText('Normal')).not.toBeInTheDocument();
    expect(within(refill).queryByText(/Unread\./)).not.toBeInTheDocument();
    expect(within(refill).getByRole('img', { name: 'Starred' })).toBeInTheDocument();
  });

  it('renders each day group as its own labelled list', () => {
    renderList({ groups: groupNotifications(ROWS, 'newest') });

    expect(screen.getByRole('heading', { name: 'Today' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Yesterday' })).toBeInTheDocument();
    const today = screen.getByRole('list', { name: 'Today' });
    expect(within(today).getAllByRole('listitem')).toHaveLength(1);
    expect(today).toHaveTextContent('Critical result: Hemoglobin');
  });

  it('shows skeleton rows while loading, and the given empty state when there are none', () => {
    const { unmount } = render(
      <NotificationList
        notifications={[]}
        selectedIds={[]}
        onSelectionChange={vi.fn()}
        onOpen={vi.fn()}
        onPatch={vi.fn()}
        onDelete={vi.fn()}
        loading
        emptyState={<p>empty</p>}
      />,
    );
    expect(screen.getByLabelText('Loading notifications')).toHaveAttribute('aria-busy', 'true');
    unmount();

    renderList({ notifications: [] });
    expect(screen.getByText('empty')).toBeInTheDocument();
  });
});
