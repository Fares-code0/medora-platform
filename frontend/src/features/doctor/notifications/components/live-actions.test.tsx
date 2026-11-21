import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { toNotification } from '../http/http-notification-service';
import { HTTP_NOTIFICATION_CAPABILITIES } from '../model/capabilities';
import type * as Capabilities from '../model/capabilities';

import { NotificationList } from './NotificationList';

/**
 * With the notifications API as the source (FE-10.8), only what it keeps is
 * offered: read and unread, and archive, favourite and pin (API §10.2,
 * served on `backend`). Delete has no route on any branch, so it is not in
 * the menu at all.
 */

vi.mock('../model/capabilities', async (importOriginal) => {
  const actual: typeof Capabilities = await importOriginal();
  return { ...actual, notificationCapabilities: actual.HTTP_NOTIFICATION_CAPABILITIES };
});

const NOTIFICATION = toNotification({
  id: 'ntf-1',
  title: 'Critical result: Hemoglobin',
  body: 'LAB-100000 was released with a critical value.',
  category: 'laboratory',
  priority: 'critical',
  kind: 'alert',
  sender: 'Laboratory',
  readAt: null,
  archived: false,
  favorite: false,
  pinned: false,
  createdAt: '2026-10-04T18:11:36.000Z',
  related: {
    patientId: 'PT-1004',
    recordId: null,
    labOrderId: 'LAB-100000',
    prescriptionId: null,
    appointmentId: null,
  },
});

describe('NotificationList with the live capabilities', () => {
  it('sends the flag a menu entry names, and only that flag', async () => {
    const onPatch = vi.fn();
    render(
      <NotificationList
        notifications={[NOTIFICATION]}
        selectedIds={[]}
        onSelectionChange={vi.fn()}
        onOpen={vi.fn()}
        onPatch={onPatch}
        onDelete={vi.fn()}
        loading={false}
        emptyState={null}
      />,
    );

    await userEvent.click(
      screen.getByRole('button', { name: /Actions for "Critical result: Hemoglobin"/ }),
    );
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Archive' }));

    expect(onPatch).toHaveBeenCalledWith(['ntf-1'], { archived: true });
  });

  it('offers what the server keeps, and no Delete', async () => {
    expect(HTTP_NOTIFICATION_CAPABILITIES.organize).toBe(true);
    expect(HTTP_NOTIFICATION_CAPABILITIES.remove).toBe(false);
    render(
      <NotificationList
        notifications={[NOTIFICATION]}
        selectedIds={[]}
        onSelectionChange={vi.fn()}
        onOpen={vi.fn()}
        onPatch={vi.fn()}
        onDelete={vi.fn()}
        loading={false}
        emptyState={null}
      />,
    );

    await userEvent.click(
      screen.getByRole('button', { name: /Actions for "Critical result: Hemoglobin"/ }),
    );

    expect(await screen.findByRole('menuitem', { name: 'Mark as read' })).toBeInTheDocument();
    for (const name of ['Add to favorites', 'Pin to top', 'Archive']) {
      expect(screen.getByRole('menuitem', { name })).toBeInTheDocument();
    }
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).not.toBeInTheDocument();
  });
});
