import { Pill } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';

import { Alert, EmptyState, ErrorState, Skeleton } from '@/components/feedback';
import { ContentHeader, PageContainer, PageSections, Stack } from '@/components/layout';
import { Breadcrumb, Card, LinkButton } from '@/components/ui';
import { routes } from '@/routes';
import { formatDate } from '@/utils/dates';

import { PRESCRIPTION_NOT_FOUND, usePrescriptionQuery } from '../api/usePrescriptionsQuery';
import { DosageSection } from '../components/detail/DosageSection';
import { MedicationDetailsSection } from '../components/detail/MedicationDetailsSection';
import { MedicationHistorySection } from '../components/detail/MedicationHistorySection';
import { PrescribingDoctorCard } from '../components/detail/PrescribingDoctorCard';
import { PrescriptionInfoCard } from '../components/detail/PrescriptionInfoCard';
import { PrescriptionNotesSection } from '../components/detail/PrescriptionNotesSection';
import { PrescriptionPatientSummaryCard } from '../components/detail/PrescriptionPatientSummaryCard';
import { PrescriptionQuickActions } from '../components/detail/PrescriptionQuickActions';
import { PrescriptionTimelineSection } from '../components/detail/PrescriptionTimelineSection';
import { SafetyWarningsSection } from '../components/detail/SafetyWarningsSection';
import { DiscardPrescriptionDraftDialog } from '../components/DiscardPrescriptionDraftDialog';
import { EndPrescriptionDialog } from '../components/EndPrescriptionDialog';
import { usePrescriptionLifecycle } from '../hooks/usePrescriptionLifecycle';

/**
 * Prescription detail — the P2 clinical document page. Read-only in
 * Phase 8 (prescriptions are reviewed, not written): safety checks,
 * medication details, dosage, notes, and history in the main column;
 * patient/prescription/prescriber/timeline context in the sticky summary
 * column. Critical safety warnings surface as a non-dismissible Alert
 * strip under the header (DS §8.22 healthcare-alert rules).
 */

function DetailSkeleton() {
  return (
    <Stack gap={6} aria-busy="true">
      <Card>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </Card>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Stack gap={3}>
            <Skeleton className="h-40 w-full rounded-surface" />
            <Skeleton className="h-40 w-full rounded-surface" />
          </Stack>
        </div>
        <Card padding="compact">
          <Stack gap={3}>
            <Skeleton className="mx-auto h-20 w-20 rounded-pill" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </Stack>
        </Card>
      </div>
    </Stack>
  );
}

export function PrescriptionDetailPage() {
  const { prescriptionId = '' } = useParams();
  const query = usePrescriptionQuery(prescriptionId);
  const navigate = useNavigate();
  // A discarded draft no longer exists: back to the list it was discarded from.
  const lifecycle = usePrescriptionLifecycle({
    onDiscarded: () => navigate(routes.doctor.pharmacy),
  });

  const notFound =
    query.isError && query.error instanceof Error && query.error.message === PRESCRIPTION_NOT_FOUND;

  const breadcrumb = (
    <Breadcrumb
      items={[
        { label: 'Overview', href: routes.doctor.overview },
        { label: 'Pharmacy', href: routes.doctor.pharmacy },
        { label: query.data?.id ?? 'Prescription' },
      ]}
    />
  );

  if (query.isPending) {
    return (
      <PageContainer width="2xl">
        <PageSections>
          {breadcrumb}
          <DetailSkeleton />
        </PageSections>
      </PageContainer>
    );
  }

  if (notFound) {
    return (
      <PageContainer width="2xl">
        <PageSections>
          {breadcrumb}
          <EmptyState
            icon={Pill}
            title="Prescription not found"
            headingLevel="h1"
            description={`No prescription with id "${prescriptionId}" exists.`}
            action={
              <LinkButton href={routes.doctor.pharmacy} variant="secondary">
                Back to pharmacy
              </LinkButton>
            }
          />
        </PageSections>
      </PageContainer>
    );
  }

  if (query.isError || query.data === undefined) {
    return (
      <PageContainer width="2xl">
        <PageSections>
          {breadcrumb}
          <ErrorState
            title="Couldn't load this prescription"
            headingLevel="h1"
            onRetry={() => void query.refetch()}
          />
        </PageSections>
      </PageContainer>
    );
  }

  const prescription = query.data;
  const criticalWarnings = prescription.warnings.filter(
    (warning) => warning.severity === 'critical',
  );

  return (
    <PageContainer width="2xl">
      <PageSections>
        <ContentHeader
          title={prescription.id}
          icon={Pill}
          tone="success"
          caption={`${prescription.medication.name} (${prescription.medication.genericName}) · ${prescription.dosage} · ${prescription.patient.name} · ${formatDate(prescription.startDate)}`}
          breadcrumb={breadcrumb}
          actions={
            <PrescriptionQuickActions
              prescription={prescription}
              onRenew={lifecycle.onRenew}
              onEnd={lifecycle.openEnd}
            />
          }
        />

        {lifecycle.ending === null ? null : (
          <EndPrescriptionDialog
            open
            act={lifecycle.ending.act}
            prescriptionId={lifecycle.ending.prescription.id}
            medicationLabel={`${lifecycle.ending.prescription.medication.name} ${lifecycle.ending.prescription.dosage}`}
            loading={lifecycle.endPending}
            onConfirm={lifecycle.onConfirmEnd}
            onClose={lifecycle.closeEnd}
          />
        )}

        {lifecycle.discarding === null ? null : (
          <DiscardPrescriptionDraftDialog
            prescriptionId={lifecycle.discarding.id}
            medicationLabel={`${lifecycle.discarding.medication.name} ${lifecycle.discarding.dosage}`}
            loading={lifecycle.discardPending}
            onConfirm={lifecycle.onConfirmDiscard}
            onClose={lifecycle.closeDiscard}
          />
        )}

        {criticalWarnings.map((warning) => (
          <Alert key={warning.id} variant="error" critical title={warning.title}>
            {warning.detail}
          </Alert>
        ))}

        {/* P2 layout: clinical document (8) + summary column (4) on lg+;
            document first, summary after, when stacked (UX §5.2). */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="min-w-0 lg:col-span-8 xl:col-span-9">
            <Stack gap={6}>
              <SafetyWarningsSection prescription={prescription} />
              <MedicationDetailsSection prescription={prescription} />
              <DosageSection prescription={prescription} />
              <PrescriptionNotesSection prescription={prescription} />
              <MedicationHistorySection prescription={prescription} />
            </Stack>
          </div>

          <div className="min-w-0 lg:col-span-4 xl:col-span-3">
            <div className="lg:sticky lg:top-6">
              <Stack gap={6}>
                <PrescriptionPatientSummaryCard prescription={prescription} />
                <PrescriptionInfoCard prescription={prescription} />
                <PrescribingDoctorCard prescription={prescription} />
                <PrescriptionTimelineSection prescription={prescription} />
              </Stack>
            </div>
          </div>
        </div>
      </PageSections>
    </PageContainer>
  );
}
