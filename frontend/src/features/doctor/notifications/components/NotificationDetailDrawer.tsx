import {
  Archive,
  ArchiveRestore,
  Calendar,
  FlaskConical,
  FolderHeart,
  Mail,
  MailOpen,
  Pill,
  Pin,
  PinOff,
  Star,
  Trash2,
  UserRound,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { Stack } from '@/components/layout';
import { Fact, FactGrid } from '@/components/patterns';
import { Badge, Button, Drawer } from '@/components/ui';
import { routes } from '@/routes';
import { formatDate, formatTime, relativeDayLabel } from '@/utils/dates';

import { notificationCapabilities } from '../model/capabilities';
import type { NotificationPatch } from '../model/notification-service';
import {
  NOTIFICATION_CATEGORY_META,
  NOTIFICATION_KIND_META,
  NOTIFICATION_PRIORITY_META,
  type DoctorNotification,
} from '../model/types';

import { CategoryIcon } from './NotificationCells';

/**
 * Notification detail — a Drawer (P3 pattern) with the full message,
 * sender/category/priority facts, links to every related clinical
 * entity, and the complete action set. Opening a notification marks it
 * read (handled by the page); actions apply immediately.
 */

export interface NotificationDetailDrawerProps {
  notification: DoctorNotification | null;
  onClose: () => void;
  onPatch: (ids: readonly string[], patch: NotificationPatch) => void;
  onDelete: (notification: DoctorNotification) => void;
}

export function NotificationDetailDrawer({
  notification,
  onClose,
  onPatch,
  onDelete,
}: NotificationDetailDrawerProps) {
  const navigate = useNavigate();

  if (notification === null) {
    return <Drawer open={false} onClose={onClose} title="Notification" size="md" children={null} />;
  }

  const one = [notification.id];
  const categoryMeta = NOTIFICATION_CATEGORY_META[notification.category];
  const priorityMeta = NOTIFICATION_PRIORITY_META[notification.priority];
  const { related } = notification;

  const go = (href: string) => {
    onClose();
    navigate(href);
  };

  return (
    <Drawer
      open
      onClose={onClose}
      title="Notification"
      size="md"
      footer={
        <>
          <Button
            variant="secondary"
            leadingIcon={notification.read ? Mail : MailOpen}
            onClick={() => onPatch(one, { read: !notification.read })}
          >
            {notification.read ? 'Mark unread' : 'Mark read'}
          </Button>
          {notificationCapabilities.organize ? (
            <Button
              variant="secondary"
              leadingIcon={notification.archived ? ArchiveRestore : Archive}
              onClick={() => {
                onPatch(one, { archived: !notification.archived });
                onClose();
              }}
            >
              {notification.archived ? 'Unarchive' : 'Archive'}
            </Button>
          ) : null}
          {notificationCapabilities.remove ? (
            <Button
              variant="destructive-secondary"
              leadingIcon={Trash2}
              onClick={() => onDelete(notification)}
            >
              Delete
            </Button>
          ) : null}
        </>
      }
    >
      <Stack gap={6}>
        <div className="flex items-start gap-3">
          <CategoryIcon category={notification.category} />
          <div className="min-w-0">
            <h3 className="text-body font-semibold text-text-primary">{notification.title}</h3>
            <p className="mt-0.5 text-caption tabular-nums text-text-tertiary">
              {formatDate(notification.createdAt)} · {formatTime(notification.createdAt)} ·{' '}
              {relativeDayLabel(notification.createdAt)}
            </p>
          </div>
        </div>

        <p className="text-body-sm text-text-secondary">{notification.body}</p>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="neutral">{categoryMeta.label}</Badge>
          <Badge variant="neutral">{NOTIFICATION_KIND_META[notification.kind].label}</Badge>
          <Badge
            variant={
              notification.priority === 'critical'
                ? 'error'
                : notification.priority === 'important'
                  ? 'warning'
                  : 'neutral'
            }
          >
            {priorityMeta.label} priority
          </Badge>
        </div>

        <FactGrid>
          <Fact label="Sender">{notification.sender}</Fact>
          <Fact label="Category">{categoryMeta.label}</Fact>
          {related.patientName ? <Fact label="Patient">{related.patientName}</Fact> : null}
          {related.recordId ? (
            <Fact label="Medical record">
              <span className="font-mono">{related.recordId}</span>
            </Fact>
          ) : null}
          {related.labId ? (
            <Fact label="Lab order">
              <span className="font-mono">{related.labId}</span>
            </Fact>
          ) : null}
          {related.prescriptionId ? (
            <Fact label="Prescription">
              <span className="font-mono">{related.prescriptionId}</span>
            </Fact>
          ) : null}
          {related.appointmentId ? (
            <Fact label="Appointment">
              <span className="font-mono">{related.appointmentId}</span>
            </Fact>
          ) : null}
        </FactGrid>

        {/* Related-entity quick navigation */}
        {related.patientId !== null ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              leadingIcon={UserRound}
              onClick={() => go(routes.doctor.patient(related.patientId ?? ''))}
            >
              View patient
            </Button>
            {related.recordId ? (
              <Button
                size="sm"
                variant="secondary"
                leadingIcon={FolderHeart}
                onClick={() =>
                  go(`${routes.doctor.medicalRecords}?patient=${related.patientId ?? ''}`)
                }
              >
                Medical record
              </Button>
            ) : null}
            {related.labId ? (
              <Button
                size="sm"
                variant="secondary"
                leadingIcon={FlaskConical}
                onClick={() => go(`${routes.doctor.labs}?patient=${related.patientId ?? ''}`)}
              >
                Lab results
              </Button>
            ) : null}
            {related.prescriptionId ? (
              <Button
                size="sm"
                variant="secondary"
                leadingIcon={Pill}
                onClick={() => go(`${routes.doctor.pharmacy}?patient=${related.patientId ?? ''}`)}
              >
                Prescriptions
              </Button>
            ) : null}
            {related.appointmentId ? (
              <Button
                size="sm"
                variant="secondary"
                leadingIcon={Calendar}
                onClick={() => go(routes.doctor.appointments)}
              >
                Appointments
              </Button>
            ) : null}
          </div>
        ) : null}

        {notificationCapabilities.organize ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              leadingIcon={Star}
              onClick={() => onPatch(one, { favorite: !notification.favorite })}
            >
              {notification.favorite ? 'Remove favorite' : 'Add to favorites'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              leadingIcon={notification.pinned ? PinOff : Pin}
              onClick={() => onPatch(one, { pinned: !notification.pinned })}
            >
              {notification.pinned ? 'Unpin' : 'Pin to top'}
            </Button>
          </div>
        ) : null}

        {related.recordId || related.labId || related.prescriptionId ? (
          <p className="text-caption text-text-secondary">
            Entity links open the module filtered to this patient — direct deep links land here when
            the API provides canonical ids.
          </p>
        ) : null}
      </Stack>
    </Drawer>
  );
}
