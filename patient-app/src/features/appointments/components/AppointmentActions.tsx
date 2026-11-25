import { useState } from 'react';

import { View } from 'react-native';

import { Button, Card, Input, Text, useToast } from '@/components';
import { BottomSheet } from '@/components/layout/BottomSheet';
import { useT, useDateFormat } from '@/i18n';
import { useTheme } from '@/theme';
import { isApiError } from '@/types/api';

import { useAcceptProposal, useCancelAppointment, useRequestReschedule } from '../hooks';
import type { AppointmentDetail } from '../model/types';

/**
 * The actions on an appointment.
 *
 * ── The one rule ─────────────────────────────────────────────────────
 * Every button below is rendered **only** because
 * `appointment.availableActions` contains its name. There is no
 * `switch (status)` in this file, no cancellation window, no "more than
 * 24 hours away" check. The server owns all of it (audit §6), and
 * `appointments.test.tsx` asserts that an appointment with an empty
 * `availableActions` renders no action whatever its status.
 *
 * ── Losing the race ──────────────────────────────────────────────────
 * A 409 means somebody at the clinic changed this while the sheet was
 * open. The server's `detail` is shown, the sheet stays open, and the
 * patient's typed reason is not thrown away — which is what
 * "recovers without losing input" means in checklist I-05.
 */
export function AppointmentActions({ appointment }: { appointment: AppointmentDetail }) {
  const theme = useTheme();
  const { formatDateTime } = useDateFormat();
  const t = useT();
  const toast = useToast();

  const [cancelOpen, setCancelOpen] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  /**
   * One box per sheet, deliberately.
   *
   * They were a single `reason` until a test asked what happens when a
   * patient opens Cancel, types "I want to cancel entirely", backs out
   * with Keep it, and then asks to reschedule: their cancellation reason
   * was waiting in the reschedule box, ready to be sent as the answer to
   * a different question. "The clinic needs a reason" and "why do you
   * need to move it?" are not the same question and do not share a
   * buffer.
   */
  const [cancelReason, setCancelReason] = useState('');
  const [rescheduleReason, setRescheduleReason] = useState('');
  const [failure, setFailure] = useState<string | null>(null);

  const cancel = useCancelAppointment(appointment.id);
  const reschedule = useRequestReschedule(appointment.id);
  const accept = useAcceptProposal(appointment.id);

  /**
   * `availableActions` is optional on the port: `undefined` means the
   * server has not said which actions are permitted, which is the truth
   * while ADR-033 is unanswered. Rendering nothing is the same OUTCOME as
   * an empty array and a different CLAIM — the app is not asserting that
   * no action exists, it is declining to guess.
   */
  const offered = appointment.availableActions ?? [];
  const proposals = appointment.proposedSlots ?? [];

  const can = (action: 'cancel' | 'reschedule' | 'confirm') => offered.includes(action);

  // A 409's `detail` is the server's own sentence about what changed and
  // is shown as sent; anything else gets this app's words.
  const describeFailure = (error: unknown): string =>
    isApiError(error) && error.kind === 'conflict' ? error.detail : t('appointment.action.failed');

  const submitCancel = async () => {
    setFailure(null);
    try {
      await cancel.mutateAsync(cancelReason.trim());
      setCancelOpen(false);
      setCancelReason('');
      toast.show(t('appointment.cancel.done'), 'success');
    } catch (error) {
      setFailure(describeFailure(error));
    }
  };

  const submitReschedule = async () => {
    setFailure(null);
    try {
      await reschedule.mutateAsync(rescheduleReason.trim());
      setRescheduleOpen(false);
      setRescheduleReason('');
      toast.show(t('appointment.reschedule.done'), 'success');
    } catch (error) {
      setFailure(describeFailure(error));
    }
  };

  const submitProposal = async (slotId: string) => {
    try {
      await accept.mutateAsync(slotId);
      toast.show(t('appointment.confirmed'), 'success');
    } catch (error) {
      toast.show(describeFailure(error), 'error');
    }
  };

  if (offered.length === 0 && proposals.length === 0) {
    return null;
  }

  return (
    <View style={{ rowGap: theme.space[3] }}>
      {/* `awaiting-patient`: the clinic proposed up to three alternatives. */}
      {can('confirm') && proposals.length > 0 ? (
        <Card tone="warning" testID="appointment-proposals">
          <Text variant="h3" color="warning">
            {t('appointment.proposals.title')}
          </Text>
          <Text variant="bodySm" color="textSecondary">
            {t('appointment.proposals.body')}
          </Text>
          <View style={{ rowGap: theme.space[2], marginTop: theme.space[2] }}>
            {proposals.map((slot) => (
              <Button
                key={slot.id}
                testID={`appointment-proposal-${slot.id}`}
                label={formatDateTime(slot.startsAt)}
                tone="secondary"
                fullWidth
                loading={accept.isPending}
                onPress={() => void submitProposal(slot.id)}
              />
            ))}
          </View>
        </Card>
      ) : null}

      {can('reschedule') ? (
        <Button
          label={t('appointment.action.reschedule')}
          tone="secondary"
          icon="refresh"
          fullWidth
          testID="appointment-reschedule"
          onPress={() => {
            setFailure(null);
            setRescheduleOpen(true);
          }}
        />
      ) : null}

      {can('cancel') ? (
        <Button
          label={t('appointment.action.cancel')}
          tone="destructive"
          icon="x"
          fullWidth
          testID="appointment-cancel"
          onPress={() => {
            setFailure(null);
            setCancelOpen(true);
          }}
        />
      ) : null}

      <BottomSheet
        visible={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title={t('appointment.cancel.sheetTitle')}
        testID="appointment-cancel-sheet"
      >
        <Text variant="bodySm" color="textSecondary">
          {t('appointment.cancel.body')}
        </Text>
        {/* `cancelled_reason` is CHECK-required server-side when the
            status is `cancelled`, so the client must collect it. */}
        <Input
          label={t('appointment.reason')}
          testID="appointment-cancel-reason"
          value={cancelReason}
          onChangeText={setCancelReason}
          multiline
          required
          {...(failure === null ? {} : { error: failure })}
        />
        <Button
          label={t('appointment.action.cancel')}
          tone="destructive"
          size="lg"
          fullWidth
          disabled={cancelReason.trim().length === 0}
          loading={cancel.isPending}
          testID="appointment-cancel-confirm"
          onPress={() => void submitCancel()}
        />
        <Button
          label={t('appointment.cancel.keep')}
          tone="secondary"
          size="lg"
          fullWidth
          onPress={() => setCancelOpen(false)}
        />
      </BottomSheet>

      <BottomSheet
        visible={rescheduleOpen}
        onClose={() => setRescheduleOpen(false)}
        title={t('appointment.action.reschedule')}
        testID="appointment-reschedule-sheet"
      >
        <Text variant="bodySm" color="textSecondary">
          {t('appointment.reschedule.body')}
        </Text>
        <Input
          label={t('appointment.reschedule.reason')}
          testID="appointment-reschedule-reason"
          value={rescheduleReason}
          onChangeText={setRescheduleReason}
          multiline
          required
          {...(failure === null ? {} : { error: failure })}
        />
        <Button
          label={t('appointment.reschedule.send')}
          size="lg"
          fullWidth
          disabled={rescheduleReason.trim().length === 0}
          loading={reschedule.isPending}
          testID="appointment-reschedule-confirm"
          onPress={() => void submitReschedule()}
        />
      </BottomSheet>
    </View>
  );
}
