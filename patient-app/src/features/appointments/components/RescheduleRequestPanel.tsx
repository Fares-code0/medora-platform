import { useRef, useState } from 'react';

import { StyleSheet, View } from 'react-native';

import { announce } from '@/accessibility/a11y';
import {
  Badge,
  Button,
  Card,
  ConfirmSheet,
  Icon,
  Text,
  useToast,
  type BadgeTone,
} from '@/components';
import { useDateFormat, useT, type MessageKey } from '@/i18n';
import { useTheme } from '@/theme';

import { classifyActionError } from '../errors';
import { useRescheduleRequests, useWithdrawRescheduleRequest } from '../hooks';
import type { RescheduleRequest, RescheduleRequestStatus } from '../model/types';

const STATUS_KEY: Readonly<Record<RescheduleRequestStatus, MessageKey>> = {
  pending: 'reschedule.status.pending',
  approved: 'reschedule.status.approved',
  rejected: 'reschedule.status.rejected',
  withdrawn: 'reschedule.status.withdrawn',
  superseded: 'reschedule.status.superseded',
};

const STATUS_TONE: Readonly<Record<RescheduleRequestStatus, BadgeTone>> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'error',
  withdrawn: 'neutral',
  superseded: 'neutral',
};

/**
 * Reschedule requests on one appointment: the open one, and the history.
 *
 * ── What it says, on purpose ─────────────────────────────────────────
 * While a request is pending the card states, in words, that **the
 * appointment is still booked at its original time until the hospital
 * approves**, and that **the requested time is not held for the patient**.
 * A patient who reads "reschedule requested" and stops coming to the
 * original slot is the failure this copy prevents.
 *
 * Withdraw is offered for a request whose own status is `pending` — that
 * is the request's state as the server reports it, not a policy computed
 * here; a stale tap is answered by the server's 409 and shown.
 */
export function RescheduleRequestPanel({
  appointmentId,
  pending,
  timeZone,
}: {
  appointmentId: string;
  pending: RescheduleRequest | null;
  timeZone: string | null;
}) {
  const theme = useTheme();
  const t = useT();
  const toast = useToast();
  const { formatDateTime } = useDateFormat();
  const history = useRescheduleRequests(appointmentId);
  const withdraw = useWithdrawRescheduleRequest();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const inFlight = useRef(false);

  const decided = (history.data ?? []).filter((request) => request.status !== 'pending');

  const submitWithdraw = async () => {
    if (pending === null || inFlight.current) return;
    inFlight.current = true;
    try {
      await withdraw.mutateAsync(pending.id);
      setConfirmOpen(false);
      toast.show(t('reschedule.withdraw.done'), 'success');
      announce(t('reschedule.withdraw.done'));
    } catch (error) {
      setConfirmOpen(false);
      const failure = classifyActionError(error);
      const message =
        failure.detail === null
          ? t(failure.messageKey)
          : `${t(failure.messageKey)} ${failure.detail}`;
      toast.show(message, 'error');
      announce(message);
    } finally {
      inFlight.current = false;
    }
  };

  if (pending === null && decided.length === 0) return null;

  return (
    <View style={{ rowGap: theme.space[3] }} testID="reschedule-panel">
      {pending === null ? null : (
        <Card tone="warning" testID="reschedule-pending">
          <View style={[styles.row, { columnGap: theme.space[2] }]}>
            <Text variant="h3" color="warning" style={styles.grow}>
              {t('reschedule.pending.title')}
            </Text>
            <Badge
              label={t(STATUS_KEY.pending)}
              tone="warning"
              testID="reschedule-pending-status"
            />
          </View>
          <Text variant="body">
            {t('reschedule.pending.requested', {
              when: formatDateTime(pending.requestedSlot.startsAt, timeZone),
            })}
          </Text>
          <View style={[styles.row, { columnGap: theme.space[2] }]}>
            <Icon name="info" size={16} color="warning" />
            <Text
              variant="bodySm"
              color="textSecondary"
              style={styles.grow}
              testID="reschedule-pending-note"
            >
              {t('reschedule.stays')}
            </Text>
          </View>
          <Text variant="bodySm" color="textSecondary">
            {t('reschedule.notHeld')}
          </Text>
          {pending.note === null ? null : (
            <Text variant="caption" color="textTertiary">
              {t('reschedule.yourNote', { note: pending.note })}
            </Text>
          )}
          <Button
            label={t('reschedule.withdraw.action')}
            tone="secondary"
            fullWidth
            loading={withdraw.isPending}
            testID="reschedule-withdraw"
            onPress={() => setConfirmOpen(true)}
          />
        </Card>
      )}

      {decided.length === 0 ? null : (
        <View style={{ rowGap: theme.space[2] }} testID="reschedule-history">
          <Text variant="label" color="textTertiary">
            {t('reschedule.history')}
          </Text>
          {decided.map((request) => (
            <Card key={request.id} testID={`reschedule-history-${request.id}`}>
              <View style={[styles.row, { columnGap: theme.space[2] }]}>
                <Text variant="bodyStrong" style={styles.grow}>
                  {formatDateTime(request.requestedSlot.startsAt, timeZone)}
                </Text>
                <Badge label={t(STATUS_KEY[request.status])} tone={STATUS_TONE[request.status]} />
              </View>
              {request.decisionReason === null ? null : (
                <Text variant="bodySm" color="textSecondary">
                  {t('reschedule.decisionReason', { reason: request.decisionReason })}
                </Text>
              )}
              {request.decidedAt === null ? null : (
                <Text variant="caption" color="textTertiary">
                  {t('reschedule.decidedAt', { when: formatDateTime(request.decidedAt, timeZone) })}
                </Text>
              )}
            </Card>
          ))}
        </View>
      )}

      <ConfirmSheet
        visible={confirmOpen}
        testID="reschedule-withdraw-sheet"
        title={t('reschedule.withdraw.title')}
        detail={t('reschedule.withdraw.detail')}
        confirmLabel={t('reschedule.withdraw.confirm')}
        cancelLabel={t('reschedule.withdraw.keep')}
        onConfirm={() => void submitWithdraw()}
        onCancel={() => setConfirmOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  row: { alignItems: 'center', flexDirection: 'row' },
});
