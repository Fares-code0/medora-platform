import { useCallback, useMemo, useState } from 'react';

import { FlaskConical } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { useDoctorProfile, useToast } from '@/app/providers';
import { Alert, ErrorState, Skeleton } from '@/components/feedback';
import { ContentHeader, PageContainer, PageSections, Stack } from '@/components/layout';
import { FlowStepper } from '@/components/patterns';
import { Breadcrumb, Button, Card, Checkbox, Select, Textarea } from '@/components/ui';
import { usePatientsQuery } from '@/features/doctor/patients/api/usePatientsQuery';
import {
  LAB_DEPARTMENTS,
  LAB_PRIORITY_META,
  type LabPriority,
  type TestSpec,
} from '@/features/shared-domain/lab-studies';
import type { Patient } from '@/features/shared-domain/patient-identity';
import { useT } from '@/i18n';
import { routes } from '@/routes';

import { useOrderLabsMutation } from '../api/useLabOrderMutation';
import { useLabCatalogueQuery } from '../api/useLabTestsQuery';
import {
  EMPTY_LAB_ORDER,
  ORDER_BLOCKED_META,
  ORDER_STEPS,
  ORDER_STEP_IDS,
  assessOrder,
  isOrderStepReachable,
  isOrderStepValid,
  orderStepIndex,
  specsFor,
  type LabOrderDraft,
  type OrderStepId,
} from '../model/ordering';
import { refusalOf } from '../model/refusal';

/**
 * Order a lab (DX-23) — the flow §0 named as missing: "a doctor still cannot
 * order a lab". D-10…D-14 built the review half and left this unbuilt, so
 * the dashboard's "Order lab" action had nothing to link to.
 *
 * Three steps rather than the prescription flow's four, because there is no
 * safety screen to run: ordering a test carries none of signing's
 * irreversibility. The stepper is the shared `FlowStepper`, promoted out of
 * the pharmacy and record flows when this became the third consumer.
 *
 * `?patient=` pre-selects and opens on Tests, the same deep-link contract
 * the prescription and record flows use, so "order a lab for this patient"
 * from a profile lands one step in rather than at the top.
 */
const NO_TESTS: readonly TestSpec[] = [];

export function NewLabOrderPage() {
  const t = useT();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const { profile } = useDoctorProfile();
  const orderedBy = profile.fullName || 'Doctor';

  const patientsQuery = usePatientsQuery();
  const patients = useMemo(() => patientsQuery.data ?? [], [patientsQuery.data]);

  const presetId = searchParams.get('patient');
  const preset = presetId === null ? null : (patients.find((p) => p.id === presetId) ?? null);

  const [draft, setDraft] = useState<LabOrderDraft>(EMPTY_LAB_ORDER);
  const [step, setStep] = useState<OrderStepId>('patient');
  const [furthest, setFurthest] = useState<OrderStepId>('patient');
  const [submitError, setSubmitError] = useState<string | null>(null);

  const orderLabs = useOrderLabsMutation();
  const catalogueQuery = useLabCatalogueQuery();
  const catalogue = catalogueQuery.data ?? NO_TESTS;

  // Applies the deep link once the roster has loaded, without making the
  // preset a second source of truth for the draft.
  const effectiveDraft: LabOrderDraft =
    draft.patient === null && preset !== null ? { ...draft, patient: preset } : draft;
  const effectiveStep: OrderStepId =
    step === 'patient' && effectiveDraft.patient !== null && preset !== null ? 'tests' : step;

  const update = useCallback((patch: Partial<LabOrderDraft>) => {
    setDraft((previous) => ({ ...previous, ...patch }));
    setSubmitError(null);
  }, []);

  const goTo = useCallback((next: OrderStepId) => {
    setStep(next);
    setFurthest((previous) =>
      orderStepIndex(next) > orderStepIndex(previous) ? next : previous,
    );
  }, []);

  const { orderable, blockedBy } = assessOrder({ draft: effectiveDraft, orderedBy, catalogue });

  const submit = () => {
    if (orderable === null) return;
    setSubmitError(null);
    orderLabs.mutate(orderable, {
      onSuccess: (created) => {
        toast({
          variant: 'success',
          title:
            created.length === 1
              ? 'Order placed'
              : `${String(created.length)} orders placed`,
        });
        // Straight to the worklist, filtered to this patient: the thing a
        // doctor wants next is confirmation it is queued, not the form again.
        navigate(`${routes.doctor.labs}?patient=${effectiveDraft.patient?.id ?? ''}`);
      },
      onError: (error) => setSubmitError(refusalOf(error)),
    });
  };

  const selected = specsFor(effectiveDraft.testCodes, catalogue);
  const currentIndex = orderStepIndex(effectiveStep);
  const nextStep = ORDER_STEP_IDS[currentIndex + 1];
  const previousStep = ORDER_STEP_IDS[currentIndex - 1];

  return (
    <PageContainer width="xl">
      <PageSections>
        <Breadcrumb
          items={[
            { label: 'Overview', href: routes.doctor.overview },
            { label: 'Labs', href: routes.doctor.labs },
            { label: 'New order' },
          ]}
        />

        <ContentHeader
          title="Order lab work"
          caption="Choose the patient, the tests, and why the lab is being asked."
        />

        <FlowStepper
          steps={ORDER_STEPS}
          current={effectiveStep}
          furthestReached={furthest}
          isStepValid={(s) => isOrderStepValid(effectiveDraft, s)}
          isStepReachable={(s) => isOrderStepReachable(effectiveDraft, s)}
          onSelect={goTo}
          ariaLabel="Lab order steps"
        />

        <Card>
          <Stack gap={4}>
            {submitError !== null ? (
              <Alert variant="error" title="The order was not placed">
                {submitError}
              </Alert>
            ) : null}

            {effectiveStep === 'patient' ? (
              <Stack gap={3}>
                <Select
                  label="Patient"
                  value={effectiveDraft.patient?.id ?? ''}
                  onChange={(value) => {
                    update({
                      patient: patients.find((p: Patient) => p.id === value) ?? null,
                    });
                  }}
                  options={[
                    { value: '', label: 'Select a patient…' },
                    ...patients.map((p: Patient) => ({
                      value: p.id,
                      label: `${p.name} · MRN ${p.mrn}`,
                    })),
                  ]}
                />
                {patientsQuery.isPending ? (
                  <p className="text-body-sm text-text-secondary">Loading the roster…</p>
                ) : null}
              </Stack>
            ) : null}

            {effectiveStep === 'tests' ? (
              <Stack gap={3}>
                <p className="text-body-sm text-text-secondary">
                  Each test becomes its own order, so results can be reviewed one at a time.
                </p>
                {catalogueQuery.isPending ? (
                  <Stack gap={2} aria-busy="true" aria-label="Loading the test catalogue">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                  </Stack>
                ) : null}
                {catalogueQuery.isError ? (
                  <ErrorState
                    title="Couldn't load the test catalogue"
                    error={catalogueQuery.error}
                    onRetry={() => void catalogueQuery.refetch()}
                  />
                ) : null}
                <ul className="flex flex-col divide-y divide-border">
                  {catalogue.map((spec) => {
                    const checked = effectiveDraft.testCodes.includes(spec.code);
                    return (
                      <li key={spec.code} className="py-2.5 first:pt-0 last:pb-0">
                        <Checkbox
                          label={`${spec.name} (${spec.code})`}
                          checked={checked}
                          onChange={() => {
                            update({
                              testCodes: checked
                                ? effectiveDraft.testCodes.filter((c) => c !== spec.code)
                                : [...effectiveDraft.testCodes, spec.code],
                            });
                          }}
                        />
                        <p className="ms-7 text-caption text-text-tertiary">
                          {spec.category} · {spec.specimen} · {spec.analytes.length} analytes
                        </p>
                      </li>
                    );
                  })}
                </ul>
              </Stack>
            ) : null}

            {effectiveStep === 'details' ? (
              <Stack gap={3}>
                <Select
                  label="Priority"
                  value={effectiveDraft.priority}
                  onChange={(value) => {
                    update({ priority: value as LabPriority });
                  }}
                  options={Object.entries(LAB_PRIORITY_META).map(([value, meta]) => ({
                    value,
                    label: t(meta.labelKey),
                  }))}
                />
                <Select
                  label="Ordering department"
                  value={effectiveDraft.department}
                  onChange={(value) => {
                    update({ department: value });
                  }}
                  options={LAB_DEPARTMENTS.map((d) => ({ value: d, label: d }))}
                />
                <Textarea
                  label="Clinical indication"
                  value={effectiveDraft.clinicalIndication}
                  onChange={(event) => {
                    update({ clinicalIndication: event.target.value });
                  }}
                  rows={3}
                  placeholder="Why is the lab being asked for this?"
                  helperText="Required — the laboratory reads it to decide add-on and reflex testing."
                />

                <div className="rounded-surface border border-border bg-surface-sunken p-3">
                  <p className="text-body-sm font-medium text-text-primary">
                    {effectiveDraft.patient?.name ?? '—'} · {selected.length} test
                    {selected.length === 1 ? '' : 's'}
                  </p>
                  <p className="text-caption text-text-secondary">
                    {selected.map((s) => s.name).join(' · ')}
                  </p>
                </div>
              </Stack>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              <div>
                {blockedBy !== null && effectiveStep === 'details' ? (
                  <p className="text-body-sm text-error">{ORDER_BLOCKED_META[blockedBy]}</p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="ghost"
                  onClick={() => {
                    navigate(routes.doctor.labs);
                  }}
                >
                  Cancel
                </Button>
                {previousStep !== undefined ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      goTo(previousStep);
                    }}
                  >
                    Back
                  </Button>
                ) : null}
                {nextStep === undefined ? (
                  <Button
                    leadingIcon={FlaskConical}
                    disabled={orderable === null || orderLabs.isPending}
                    onClick={submit}
                  >
                    {orderLabs.isPending ? 'Placing…' : 'Place order'}
                  </Button>
                ) : (
                  <Button
                    disabled={!isOrderStepValid(effectiveDraft, effectiveStep)}
                    onClick={() => {
                      goTo(nextStep);
                    }}
                  >
                    Continue
                  </Button>
                )}
              </div>
            </div>
          </Stack>
        </Card>
      </PageSections>
    </PageContainer>
  );
}
