import { useState } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { View } from 'react-native';

import { headingA11y } from '@/accessibility/a11y';
import {
  AsyncBoundary,
  Badge,
  Button,
  Card,
  ConfirmSheet,
  Screen,
  Section,
  Text,
  useToast,
} from '@/components';
import { useT, useDateFormat } from '@/i18n';
import { useTheme } from '@/theme';

import { profileKeys } from '../keys';
import type { PrivacyRequest, PrivacyState } from '../model/types';
import { profileService } from '../service';

/**
 * Your data — checklist P-09, P-10.
 *
 * ── Two requests, and the second one is not what patients expect ─────
 *
 * "Delete my account" is the phrase people arrive with, and this screen
 * deliberately never uses it. **PHI is never hard-deleted** (DB §7): a
 * clinic is required to keep a medical record for years after a patient
 * stops using an app, and an app that offered deletion would either be
 * lying or breaking that requirement. So the control asks the clinic to
 * **close the account** — the sign-in stops working, the record stays
 * with the clinic — and the copy says exactly that, before the
 * confirmation rather than after it.
 *
 * The confirmation is a `ConfirmSheet` (R-06) because the action is
 * effectively irreversible from the patient's side: reopening is a
 * conversation with the clinic, not a button.
 *
 * ── Why nothing here downloads anything ──────────────────────────────
 *
 * An export is a job that runs on the server and finishes minutes later
 * (BE-10). This screen requests it and says so; the file arrives the way
 * the row specifies — a notification when it is ready. There is no
 * progress bar, because this client cannot see the job, and no
 * "Download" button, because a mobile client that cannot show the file
 * would be handing the patient a dead control.
 *
 * ── Both are refused today ───────────────────────────────────────────
 *
 * `getPrivacyState`, `requestDataExport` and `requestDeactivation` are
 * BE-10 (M8) and refuse by name. Unlike Home's activity feed or the
 * department filter, this screen shows the refusal rather than hiding
 * it: a patient who came here to ask for their data is owed an answer,
 * and silence would read as "asked and ignored". The whole screen is one
 * `AsyncBoundary` for that reason.
 */
function requestBadge(
  request: PrivacyRequest,
  t: ReturnType<typeof useT>,
): { label: string; tone: 'primary' | 'success' | 'warning' } | null {
  switch (request.status) {
    case 'none':
      return null;
    case 'pending':
      return { label: t('privacy.status.pending'), tone: 'primary' };
    case 'ready':
      return { label: t('privacy.status.ready'), tone: 'success' };
    case 'refused':
      return { label: t('privacy.status.refused'), tone: 'warning' };
  }
}

export function PrivacyScreen() {
  const theme = useTheme();
  const { formatDate } = useDateFormat();
  const t = useT();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [confirmClose, setConfirmClose] = useState(false);

  const privacyKey = profileKeys.privacy();
  const privacy = useQuery({
    queryKey: privacyKey,
    queryFn: () => profileService.getPrivacyState(),
  });

  /**
   * Not optimistic, and that is the rule rather than an omission.
   * `optimistic.ts` allows optimism only where this client already knows
   * the server's answer; whether a clinic accepts a request to close an
   * account is the clinic's decision. The state comes back from the
   * server and is written as it was returned.
   */
  const write = (
    mutationFn: () => Promise<PrivacyState>,
    successKey: 'privacy.export.requested' | 'privacy.close.requested',
  ) => ({
    mutationFn,
    onSuccess: (next: PrivacyState) => {
      queryClient.setQueryData(privacyKey, next);
      toast.show(t(successKey), 'success');
    },
    onError: () => toast.show(t('privacy.failed'), 'error'),
  });

  const exportRequest = useMutation(
    write(() => profileService.requestDataExport(), 'privacy.export.requested'),
  );
  const closeRequest = useMutation(
    write(() => profileService.requestDeactivation(), 'privacy.close.requested'),
  );

  return (
    <Screen testID="privacy-screen">
      <Text variant="h1" {...headingA11y(t('privacy.title'))}>
        {t('privacy.title')}
      </Text>

      <AsyncBoundary query={privacy} testID="privacy">
        {(state) => {
          const exportBadge = requestBadge(state.export, t);
          const closeBadge = requestBadge(state.deactivation, t);
          const exportPending = state.export.status === 'pending';
          const closePending = state.deactivation.status === 'pending';

          return (
            <View style={{ rowGap: theme.space[5] }}>
              <Section title={t('privacy.export.title')}>
                <Card testID="privacy-export">
                  <Text variant="bodySm" color="textSecondary">
                    {t('privacy.export.body')}
                  </Text>

                  {exportBadge === null ? null : (
                    <View style={{ marginTop: theme.space[2] }}>
                      <Badge label={exportBadge.label} tone={exportBadge.tone} />
                    </View>
                  )}

                  {state.export.requestedAt === null ? null : (
                    <Text variant="caption" color="textTertiary">
                      {t('privacy.requestedOn', { date: formatDate(state.export.requestedAt) })}
                    </Text>
                  )}

                  {/*
                    One request at a time. A second "Request" while the
                    first is running would either queue a duplicate job or
                    be silently ignored, and neither is something to
                    offer a patient — the row already says so.
                  */}
                  <Button
                    label={exportPending ? t('privacy.export.pendingCta') : t('privacy.export.cta')}
                    tone="secondary"
                    fullWidth
                    disabled={exportPending}
                    loading={exportRequest.isPending}
                    testID="privacy-export-request"
                    onPress={() => exportRequest.mutate()}
                  />
                </Card>
              </Section>

              <Section title={t('privacy.close.title')}>
                <Card testID="privacy-close">
                  {/*
                    The most important sentence on the screen, and it is
                    above the control rather than inside the confirmation:
                    a patient deciding whether to tap needs to know their
                    record is not what is being closed.
                  */}
                  <Text variant="bodySm" color="textSecondary">
                    {t('privacy.close.body')}
                  </Text>
                  <Text variant="bodySm" color="textTertiary">
                    {t('privacy.close.retention')}
                  </Text>

                  {closeBadge === null ? null : (
                    <View style={{ marginTop: theme.space[2] }}>
                      <Badge label={closeBadge.label} tone={closeBadge.tone} />
                    </View>
                  )}

                  {state.deactivation.requestedAt === null ? null : (
                    <Text variant="caption" color="textTertiary">
                      {t('privacy.requestedOn', {
                        date: formatDate(state.deactivation.requestedAt),
                      })}
                    </Text>
                  )}

                  <Button
                    label={closePending ? t('privacy.close.pendingCta') : t('privacy.close.cta')}
                    tone="destructive"
                    fullWidth
                    disabled={closePending}
                    loading={closeRequest.isPending}
                    testID="privacy-close-request"
                    onPress={() => setConfirmClose(true)}
                  />
                </Card>
              </Section>
            </View>
          );
        }}
      </AsyncBoundary>

      <ConfirmSheet
        visible={confirmClose}
        testID="privacy-close-confirm"
        title={t('privacy.close.confirmTitle')}
        detail={t('privacy.close.confirmDetail')}
        confirmLabel={t('privacy.close.confirmCta')}
        tone="destructive"
        onConfirm={() => {
          setConfirmClose(false);
          closeRequest.mutate();
        }}
        onCancel={() => setConfirmClose(false)}
      />
    </Screen>
  );
}
