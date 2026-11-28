import { useRef, useState } from 'react';

import { View } from 'react-native';

import { announce } from '@/accessibility/a11y';
import { Button, Input, Text, useToast } from '@/components';
import { BottomSheet } from '@/components/layout/BottomSheet';
import { useT } from '@/i18n';
import { useTheme } from '@/theme';

import { classifyActionError, type ActionFailure } from '../errors';
import { useCancelAppointment } from '../hooks';
import type { AppointmentDetail, CancelReasonCode } from '../model/types';

import { ActionFailureCard } from './ActionFailureCard';
import { ReasonPicker } from './ReasonPicker';

/** The server's limit on the optional cancellation note. */
const CANCEL_NOTE_MAX = 200;

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
 * ── Cancel ───────────────────────────────────────────────────────────
 * A reason from the server's closed list is required, with an optional
 * note. The sheet stays open on a failure, with what the patient chose
 * and typed, and says what went wrong — a 409 shows the server's own
 * `detail` and the appointment is refetched so the buttons follow the
 * server's new answer.
 *
 * ── Reschedule ───────────────────────────────────────────────────────
 * "Ask to reschedule" opens the request screen (`onAskReschedule`); it is
 * a request, and nothing about the appointment changes until the hospital
 * approves.
 */
export function AppointmentActions({
  appointment,
  onAskReschedule,
}: {
  appointment: AppointmentDetail;
  onAskReschedule: () => void;
}) {
  const theme = useTheme();
  const t = useT();
  const toast = useToast();

  const [cancelOpen, setCancelOpen] = useState(false);
  const [reasonCode, setReasonCode] = useState<CancelReasonCode | null>(null);
  const [note, setNote] = useState('');
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const cancel = useCancelAppointment(appointment.id);
  /** A second press before the first settles must not send a second request. */
  const inFlight = useRef(false);

  const offered = appointment.availableActions;
  const can = (action: 'cancel' | 'reschedule') => offered.includes(action);

  const submitCancel = async () => {
    if (reasonCode === null || inFlight.current) return;
    inFlight.current = true;
    setFailure(null);
    try {
      const trimmed = note.trim();
      await cancel.mutateAsync({
        reasonCode,
        ...(trimmed === '' ? {} : { note: trimmed }),
      });
      setCancelOpen(false);
      setReasonCode(null);
      setNote('');
      toast.show(t('appointment.cancel.done'), 'success');
      announce(t('appointment.cancel.done'));
    } catch (error) {
      const classified = classifyActionError(error);
      setFailure(classified);
      announce(t(classified.messageKey));
    } finally {
      inFlight.current = false;
    }
  };

  if (offered.length === 0) return null;

  return (
    <View style={{ rowGap: theme.space[3] }}>
      {can('reschedule') ? (
        <Button
          label={t('appointment.action.reschedule')}
          tone="secondary"
          icon="refresh"
          fullWidth
          testID="appointment-reschedule"
          onPress={onAskReschedule}
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
        <ReasonPicker value={reasonCode} onChange={setReasonCode} disabled={cancel.isPending} />
        <Input
          label={t('appointment.cancel.noteLabel')}
          testID="appointment-cancel-note"
          value={note}
          onChangeText={(value) => setNote(value.slice(0, CANCEL_NOTE_MAX))}
          multiline
          disabled={cancel.isPending}
          hint={t('appointment.cancel.noteHint', { used: note.length, max: CANCEL_NOTE_MAX })}
        />
        {failure === null ? null : <ActionFailureCard failure={failure} testID="cancel-failure" />}
        <Button
          label={t('appointment.action.cancel')}
          tone="destructive"
          size="lg"
          fullWidth
          disabled={reasonCode === null}
          loading={cancel.isPending}
          testID="appointment-cancel-confirm"
          onPress={() => void submitCancel()}
        />
        <Button
          label={t('appointment.cancel.keep')}
          tone="secondary"
          size="lg"
          fullWidth
          disabled={cancel.isPending}
          onPress={() => setCancelOpen(false)}
        />
      </BottomSheet>
    </View>
  );
}
