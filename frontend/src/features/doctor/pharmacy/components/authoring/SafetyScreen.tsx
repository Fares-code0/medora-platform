import { useEffect, useRef } from 'react';

import { Alert, Spinner } from '@/components/feedback';
import { Stack } from '@/components/layout';
import { StatusBadge } from '@/components/patterns';
import { Button, Card, Textarea } from '@/components/ui';

import {
  SAFETY_EVIDENCE_META,
  blockingWarnings,
  reasonRequired,
  warningsNeedingAcknowledgment,
  type SafetyVerdict,
} from '../../model/safety-check';
import { SAFETY_WARNING_SEVERITY_META } from '../../model/types';

import { SafetyWarningAlert } from './SafetyWarningAlert';

/**
 * The blocking safety screen (D-17, UX §2.7).
 *
 * "Blocked, not merely busy" is structural, not cosmetic. While the check
 * runs this component is the only thing between Dosage and Review, and the
 * Review step does not exist to navigate to: the flow's `safetyCleared` is
 * false, so `canAdvanceTo` refuses the transition. There is no spinner
 * overlaid on a reachable Review, and no disabled Sign button waiting to be
 * re-enabled — Review is simply not a place the machine can be in.
 *
 * **Fail closed.** A failed verdict offers exactly the two actions §2.7
 * allows: Retry, and Save as draft. There is no third button, and the sign
 * control lives on Review, which this state cannot reach.
 *
 * **Announcement (F-18).** One polite live region owns the whole
 * progress→outcome narration, so a screen-reader user hears "Checking…" and
 * then the result without the alert stack replaying itself on every
 * re-render. The failure banner is additionally `role="alert"` by virtue of
 * `Alert`'s error variant, which is the one interruption worth making.
 *
 * **Whose record (WEB-8, DR-03/DR-04).** The screen says it checked *this
 * hospital's* record. A patient has one Medical Record per hospital, and a
 * clean screen here says nothing about allergies another hospital holds.
 */

export interface SafetyScreenProps {
  phase: 'idle' | 'running' | 'settled';
  verdict: SafetyVerdict | null;
  acknowledgedIds: readonly string[];
  acknowledgmentReason: string;
  onToggleAcknowledged: (warningId: string) => void;
  onReasonChange: (reason: string) => void;
  onRetry: () => void;
  onSaveDraft: () => void;
  onChangeMedication: () => void;
  savingDraft: boolean;
  /** Rendered under the stack on Review; hidden while the screen blocks. */
  children?: React.ReactNode;
}

function announcement(props: Pick<SafetyScreenProps, 'phase' | 'verdict'>): string {
  const { phase, verdict } = props;
  if (phase === 'running')
    return 'Checking interactions. The prescription cannot be signed until this completes.';
  if (verdict === null) return '';
  if (verdict.status === 'failed') {
    return `${verdict.message} The prescription cannot be signed. Retry the check or save it as a draft.`;
  }
  if (verdict.warnings.length === 0) return 'Safety screen complete. No warnings were raised.';
  const critical = verdict.warnings.filter((warning) => warning.severity === 'critical').length;
  return `Safety screen complete. ${String(verdict.warnings.length)} warning${
    verdict.warnings.length === 1 ? '' : 's'
  } raised, ${String(critical)} critical. Review and acknowledge each one before signing.`;
}

export function SafetyScreen(props: SafetyScreenProps) {
  const {
    phase,
    verdict,
    acknowledgedIds,
    acknowledgmentReason,
    onToggleAcknowledged,
    onReasonChange,
    onRetry,
    onSaveDraft,
    onChangeMedication,
    savingDraft,
    children,
  } = props;

  const headingRef = useRef<HTMLSpanElement>(null);

  /*
   * Focus must not be lost when the screen blocks. The check starts from a
   * button on Dosage that is then replaced, so without this the focus ring
   * falls back to <body> and a keyboard user is stranded mid-flow.
   */
  useEffect(() => {
    if (phase === 'running') headingRef.current?.focus();
  }, [phase]);

  const failed = verdict?.status === 'failed';
  const completed = verdict?.status === 'completed' ? verdict : null;
  const blocking = completed ? blockingWarnings(completed) : [];
  const needAcknowledgment = completed ? warningsNeedingAcknowledgment(completed) : [];
  const needsReason = completed !== null && reasonRequired(completed);
  const pastCritical = needAcknowledgment.some((warning) => warning.severity === 'critical');
  const evidence = SAFETY_EVIDENCE_META[completed?.source ?? 'demo-formulary'];

  return (
    <Card
      /*
       * A plain string, deliberately: `Card` only emits a real heading
       * element for a string title, and an icon-decorated node would render
       * the card with no heading at all — which is how an h2 → h4 skip crept
       * in here before F-17's rule was re-checked against the live DOM.
       */
      title="Safety screen"
      headingAs="h3"
      subtitle="Allergy conflicts, drug–drug interactions, and duplicate therapy, screened against this hospital's record of the patient."
      tone={failed ? 'error' : blocking.length > 0 ? 'error' : 'success'}
    >
      {/* One live region for the whole screen (F-18). */}
      <p aria-live="polite" className="sr-only" data-testid="safety-announcement">
        {announcement({ phase, verdict })}
      </p>

      {/* Focus target while the screen blocks. Not a heading — the card's
          own h3 is the heading, and a second one would skip a level. */}
      <span ref={headingRef} tabIndex={-1} className="sr-only">
        Safety screen
      </span>

      <Stack gap={4}>
        {phase === 'running' ? (
          <div
            className="flex items-center gap-3 rounded-surface border border-border bg-surface-sunken p-4"
            data-testid="safety-blocking"
          >
            <Spinner size="sm" label="Checking interactions" />
            <div>
              <p className="text-body-sm font-medium text-text-primary">Checking interactions…</p>
              <p className="text-caption text-text-secondary">
                The prescription cannot be reviewed or signed until this check completes.
              </p>
            </div>
          </div>
        ) : null}

        {failed && verdict.status === 'failed' ? (
          <>
            <Alert
              variant="error"
              critical
              title="Interaction check unavailable — this prescription cannot be signed right now"
            >
              <Stack gap={2}>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status="critical" label="Check failed" />
                  <StatusBadge
                    status="info"
                    label={verdict.reason === 'timeout' ? 'Timed out' : 'No usable result'}
                  />
                </div>
                <p>
                  {verdict.message} A prescription is only signable on a completed screen, so
                  signing stays unavailable until this check succeeds. Retry it, or keep the work as
                  a draft and come back.
                </p>
              </Stack>
            </Alert>
            <div className="flex flex-wrap gap-2">
              <Button onClick={onRetry}>Retry check</Button>
              <Button variant="secondary" onClick={onSaveDraft} loading={savingDraft}>
                Save as draft
              </Button>
            </div>
          </>
        ) : null}

        {completed ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge
                status={
                  completed.warnings.length === 0
                    ? 'normal'
                    : SAFETY_WARNING_SEVERITY_META[completed.warnings[0]?.severity ?? 'info'].kind
                }
                label={
                  completed.warnings.length === 0
                    ? 'Checked — no warnings'
                    : `Checked — ${String(completed.warnings.length)} warning${completed.warnings.length === 1 ? '' : 's'}`
                }
              />
              {evidence.isDemo ? <StatusBadge status="info" label={evidence.label} /> : null}
            </div>

            {evidence.isDemo ? (
              <p className="text-caption text-text-tertiary">{evidence.detail}</p>
            ) : null}

            {completed.warnings.length === 0 ? (
              <Alert variant="success" title="No safety warnings">
                No allergy conflict, interaction, or duplicate therapy was found against the
                allergies and active medications in this hospital&apos;s record of the patient.
              </Alert>
            ) : (
              <Stack gap={3}>
                {completed.warnings.map((warning) => {
                  const needsTick = needAcknowledgment.some((entry) => entry.id === warning.id);
                  return (
                    <SafetyWarningAlert
                      key={warning.id}
                      warning={warning}
                      {...(needsTick
                        ? {
                            acknowledgement: {
                              checked: acknowledgedIds.includes(warning.id),
                              onToggle: () => onToggleAcknowledged(warning.id),
                            },
                          }
                        : {})}
                    />
                  );
                })}
              </Stack>
            )}

            {blocking.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                <Button onClick={onChangeMedication}>Change medication</Button>
                <Button variant="secondary" onClick={onSaveDraft} loading={savingDraft}>
                  Save as draft
                </Button>
              </div>
            ) : null}

            {needsReason ? (
              <Textarea
                label={
                  pastCritical
                    ? 'Reason for proceeding past a critical warning'
                    : 'Reason for proceeding past these warnings'
                }
                required
                rows={2}
                value={acknowledgmentReason}
                onChange={(event) => onReasonChange(event.target.value)}
                placeholder="e.g. Benefit outweighs the risk; INR monitoring arranged weekly."
                helperText="Recorded on the prescription and audit-logged. Required before signing past these warnings."
              />
            ) : null}

            {children}
          </>
        ) : null}
      </Stack>
    </Card>
  );
}
