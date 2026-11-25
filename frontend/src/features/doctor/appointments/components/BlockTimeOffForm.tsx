import { useEffect, useRef, useState } from 'react';

import { useBlocker } from 'react-router-dom';

import { useAuth } from '@/app/providers';
import { Alert } from '@/components/feedback';
import { Stack } from '@/components/layout';
import { Button, Card, ConfirmationDialog, Input, Select } from '@/components/ui';
import { useT, type MessageKey, type TranslateFn } from '@/i18n';
import { isApiError } from '@/types/api';

import {
  useCreateTimeOffMutation,
  useFreshTimeOffFetcher,
  usePreviewImpactFetcher,
} from '../api/useAppointmentsQuery';
import { timeOffErrorMessage, timeOffSpan } from '../model/time-off-copy';
import { clearBlock, sameWindow, settleSaved } from '../model/time-off-follow-up';
import type { TimeOffCreated, TimeOffKind } from '../model/time-off-service';

import { TimeOffImpactStep, type ToastOptions } from './TimeOffImpactStep';

/**
 * Block time off, and emergency unavailability (UX §2.4, FE-10.4) — the
 * form of the Block Time Off page.
 *
 * 1. **The window.** From, to (date and time, so a partial day is just a
 *    shorter window), and whether it is planned (vacation) or an emergency.
 *    The contract (`POST /me/time-off`) takes exactly `from`, `to` and
 *    `kind`: no reason, full-day flag or recurrence, so the form offers none.
 * 2. **The follow-up** (`TimeOffImpactStep`): every appointment inside the
 *    window and what to do about them.
 *
 * ── Never abandoning the follow-up silently ──────────────────────────
 * The block is booked by the first request; the appointments inside it are
 * only decided by the second. So:
 *
 * - while the create is in flight, and while booked appointments wait for a
 *   decision, leaving the page asks first (in-app navigation through the
 *   router's blocker; a reload or tab close through `beforeunload`);
 * - if the doctor leaves anyway, or the page is lost mid-request, the
 *   create's own callbacks record the block as needing its follow-up
 *   (`model/time-off-follow-up.ts`), and Upcoming Time Off offers it again
 *   with the impact re-read from the server;
 * - before booking, the doctor's existing blocks are read fresh: if this
 *   exact window and kind is already booked — typically a previous attempt
 *   whose answer never arrived — no second block is created; the form goes
 *   straight to that block's follow-up. The server does not reject a
 *   duplicate itself, so this check is the only thing that prevents one.
 */

type Phase =
  { readonly kind: 'window' } | { readonly kind: 'impact'; readonly created: TimeOffCreated };

const KIND_OPTIONS: readonly { readonly value: TimeOffKind; readonly labelKey: MessageKey }[] = [
  { value: 'vacation', labelKey: 'timeOff.kind.vacation' },
  { value: 'emergency-block', labelKey: 'timeOff.kind.emergency' },
];

function localNow(offsetHours = 0): string {
  const date = new Date(Date.now() + offsetHours * 3_600_000);
  date.setMinutes(0, 0, 0);
  // `datetime-local` wants local wall-clock time without a zone.
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

type WindowError = 'fromRequired' | 'toRequired' | 'order';

interface WindowErrors {
  readonly from?: WindowError;
  readonly to?: WindowError;
}

function validateWindow(from: string, to: string): WindowErrors {
  const errors: { from?: WindowError; to?: WindowError } = {};
  if (from === '' || Number.isNaN(new Date(from).getTime())) errors.from = 'fromRequired';
  if (to === '' || Number.isNaN(new Date(to).getTime())) errors.to = 'toRequired';
  if (errors.from === undefined && errors.to === undefined && new Date(from) >= new Date(to)) {
    errors.to = 'order';
  }
  return errors;
}

const WINDOW_ERROR_KEYS: Readonly<Record<WindowError, MessageKey>> = {
  fromRequired: 'timeOff.form.fromRequired',
  toRequired: 'timeOff.form.toRequired',
  order: 'timeOff.form.order',
};

/** A create failure that proves nothing was booked gets the server's words; any other may have booked it. */
function createErrorMessage(t: TranslateFn, error: unknown): string {
  if (
    isApiError(error) &&
    (error.kind === 'network' || error.kind === 'server') /* the block may exist */
  ) {
    return t('timeOff.error.unknown');
  }
  if (!isApiError(error)) return t('timeOff.error.unknown');
  return timeOffErrorMessage(t, error);
}

export interface BlockTimeOffFormProps {
  /** Leave without booking (or after a booked block, without deciding). */
  readonly onCancel: () => void;
  /**
   * The flow is over and the server confirmed every step. `toast` is what to
   * announce, or `null` when the outcome is already on screen.
   */
  readonly onFinished: (toast: ToastOptions | null) => void;
}

export function BlockTimeOffForm({ onCancel, onFinished }: BlockTimeOffFormProps) {
  const t = useT();
  const userId = useAuth().user?.id ?? null;
  const [from, setFrom] = useState(() => localNow(1));
  const [to, setTo] = useState(() => localNow(9));
  const [kind, setKind] = useState<TimeOffKind>('vacation');
  const [submitted, setSubmitted] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'window' });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [reloading, setReloading] = useState(false);
  // The mutation's `isPending` lands a render late; a second click inside
  // that render must not book the window twice.
  const inFlight = useRef(false);

  const create = useCreateTimeOffMutation();
  const freshBlocks = useFreshTimeOffFetcher();
  const previewImpact = usePreviewImpactFetcher();

  const saving = checking || create.isPending;
  /*
   * Leaving costs something while a request is out or a decision is owed.
   * Read through a ref so a navigation the flow itself starts — after the
   * decision is confirmed — is never stopped by a guard a render behind.
   */
  const guarded = saving || resolving || phase.kind === 'impact';
  const guardRef = useRef(guarded);
  guardRef.current = guarded;

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      guardRef.current && currentLocation.pathname !== nextLocation.pathname,
  );

  useEffect(() => {
    if (!guarded) return undefined;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Legacy browsers key off returnValue rather than preventDefault.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [guarded]);

  const errors = validateWindow(from, to);
  // Required-field errors wait for a submit; an inverted window is said at once.
  const fromError = submitted && errors.from ? t(WINDOW_ERROR_KEYS[errors.from]) : undefined;
  const toError =
    errors.to !== undefined && (submitted || errors.to === 'order')
      ? t(WINDOW_ERROR_KEYS[errors.to])
      : undefined;

  const finish = (toastOptions: ToastOptions | null) => {
    guardRef.current = false;
    onFinished(toastOptions);
  };

  const showImpact = (created: TimeOffCreated) => {
    if (created.impacted.length === 0) {
      if (userId !== null) clearBlock(userId, created.block.id);
      finish({
        variant: 'success',
        title: t('timeOff.toast.blocked'),
        description: t('timeOff.toast.noneInside', { span: timeOffSpan(t, created.block) }),
      });
      return;
    }
    setPhase({ kind: 'impact', created });
  };

  const submitWindow = async () => {
    setSubmitted(true);
    setError(null);
    setNotice(null);
    if (errors.from !== undefined || errors.to !== undefined) return;
    if (inFlight.current) return;
    inFlight.current = true;
    const input = { from: new Date(from).toISOString(), to: new Date(to).toISOString(), kind };

    setChecking(true);
    try {
      const existing = (await freshBlocks()).find((block) => sameWindow(input, block));
      if (existing !== undefined) {
        // Already booked — a previous attempt whose answer never arrived.
        const impacted = await previewImpact(existing);
        if (userId !== null) {
          settleSaved(userId, `existing-${existing.id}`, existing, impacted.length);
        }
        setNotice(t('timeOff.form.alreadyBooked'));
        showImpact({ block: existing, impacted });
        inFlight.current = false;
        setChecking(false);
        return;
      }
    } catch {
      setError(t('timeOff.error.checkFailed'));
      inFlight.current = false;
      setChecking(false);
      return;
    }
    setChecking(false);

    create.mutate(input, {
      onSuccess: showImpact,
      onError: (failure) => setError(createErrorMessage(t, failure)),
      onSettled: () => {
        inFlight.current = false;
      },
    });
  };

  const reloadImpact = (created: TimeOffCreated) => {
    setReloading(true);
    previewImpact(created.block).then(
      (impacted) => {
        setReloading(false);
        if (impacted.length === 0) {
          if (userId !== null) clearBlock(userId, created.block.id);
          finish({
            variant: 'success',
            title: t('timeOff.toast.blocked'),
            description: t('timeOff.toast.noneInside', { span: timeOffSpan(t, created.block) }),
          });
          return;
        }
        setPhase({ kind: 'impact', created: { block: created.block, impacted } });
      },
      () => {
        setReloading(false);
        setError(t('timeOff.followUp.error'));
      },
    );
  };

  const guardDialog = (
    <ConfirmationDialog
      open={blocker.state === 'blocked'}
      onClose={() => blocker.reset?.()}
      onConfirm={() => blocker.proceed?.()}
      title={saving ? t('timeOff.guard.savingTitle') : t('timeOff.guard.impactTitle')}
      description={saving ? t('timeOff.guard.savingBody') : t('timeOff.guard.impactBody')}
      confirmLabel={t('timeOff.guard.leave')}
      cancelLabel={t('timeOff.guard.stay')}
      tone="destructive"
    />
  );

  if (phase.kind === 'impact') {
    const { created } = phase;
    return (
      <Stack gap={3}>
        {notice === null ? null : <Alert variant="info" title={notice} />}
        {error === null ? null : <Alert variant="error" title={error} />}
        <TimeOffImpactStep
          key={created.impacted.map((appointment) => appointment.id).join(',')}
          block={created.block}
          impacted={created.impacted}
          reloading={reloading}
          onReload={() => reloadImpact(created)}
          onClose={onCancel}
          onPendingChange={setResolving}
          onDecided={() => {
            if (userId !== null) clearBlock(userId, created.block.id);
          }}
          onDone={finish}
        />
        {guardDialog}
      </Stack>
    );
  }

  return (
    <>
      <Card
        title={t('timeOff.form.title')}
        subtitle={t('timeOff.form.subtitle')}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={onCancel} disabled={saving}>
              {t('timeOff.form.cancel')}
            </Button>
            <Button type="submit" form="block-time-off" loading={saving} disabled={saving}>
              {t('timeOff.form.submit')}
            </Button>
          </div>
        }
      >
        <form
          id="block-time-off"
          noValidate
          aria-busy={saving}
          onSubmit={(event) => {
            event.preventDefault();
            void submitWindow();
          }}
        >
          <Stack gap={4}>
            <Select
              label={t('timeOff.form.kind')}
              value={kind}
              onChange={(value) => setKind(value as TimeOffKind)}
              options={KIND_OPTIONS.map((option) => ({
                value: option.value,
                label: t(option.labelKey),
              }))}
            />
            <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-[repeat(2,minmax(0,1fr))]">
              <Input
                type="datetime-local"
                label={t('timeOff.form.from')}
                required
                value={from}
                error={fromError}
                onChange={(event) => setFrom(event.target.value)}
              />
              <Input
                type="datetime-local"
                label={t('timeOff.form.to')}
                required
                value={to}
                error={toError}
                onChange={(event) => setTo(event.target.value)}
              />
            </div>
            {saving ? (
              <p role="status" className="text-body-sm text-text-secondary">
                {t('timeOff.form.saving')}
              </p>
            ) : null}
            {error === null ? null : <Alert variant="error" title={error} />}
          </Stack>
        </form>
      </Card>
      {guardDialog}
    </>
  );
}
