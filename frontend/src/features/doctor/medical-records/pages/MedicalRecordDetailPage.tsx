import { FileQuestion, FolderHeart } from 'lucide-react';
import { useParams } from 'react-router-dom';

import { Alert, EmptyState, ErrorState, Skeleton } from '@/components/feedback';
import { ContentHeader, PageContainer, PageSections, Stack } from '@/components/layout';
import { Breadcrumb, Card, LinkButton } from '@/components/ui';
import { useDisclosure } from '@/hooks/useDisclosure';
import { routes } from '@/routes';
import { formatDate } from '@/utils/dates';

import { RECORD_NOT_FOUND, useMedicalRecordQuery } from '../api/useMedicalRecordsQuery';
import { AmendRecordDialog } from '../components/AmendRecordDialog';
import { RecordAllergiesSection } from '../components/detail/RecordAllergiesSection';
import { RecordAttachmentsSection } from '../components/detail/RecordAttachmentsSection';
import { RecordDiagnosesSection } from '../components/detail/RecordDiagnosesSection';
import { RecordEditHistorySection } from '../components/detail/RecordEditHistorySection';
import { RecordMedicationsSection } from '../components/detail/RecordMedicationsSection';
import { RecordNotesSection } from '../components/detail/RecordNotesSection';
import { RecordPatientSummaryCard } from '../components/detail/RecordPatientSummaryCard';
import { RecordQuickActions } from '../components/detail/RecordQuickActions';
import { EmptySectionNote, RecordSectionCard } from '../components/detail/RecordSectionCard';
import { RecordTimelineSection } from '../components/detail/RecordTimelineSection';
import { RecordVisitInfoCard } from '../components/detail/RecordVisitInfoCard';
import { RecordVitalsSection } from '../components/detail/RecordVitalsSection';
import { EditRecordDialog } from '../components/EditRecordDialog';
import { ReportRecordIssueDialog } from '../components/ReportRecordIssueDialog';
import { SignNoteDialog } from '../components/SignNoteDialog';
import { useRecordLifecycleActions } from '../hooks/useRecordLifecycleActions';
import { RECORD_ALLERGY_SEVERITY_META } from '../model/types';

/**
 * Medical record detail — the P2 clinical document page. Read-only in
 * Phase 6 (editing is out of scope): narrative sections in the main
 * column, identity/visit/timeline context in the sticky summary column,
 * and the fixed allergy strip under the header (UX 1.5 rule 4: allergy
 * data never lives only in a section).
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

/*
 * D-21 made this page writable: an unsigned note of your own can be signed
 * here, a signed record accepts an addendum, and the status moves along the
 * transition map. All three go through `useRecordLifecycleActions`, and all
 * three are pessimistic — nothing shows as signed, amended or moved before
 * the write lands.
 */
export function MedicalRecordDetailPage() {
  const { recordId = '' } = useParams();
  const query = useMedicalRecordQuery(recordId);
  const actions = useRecordLifecycleActions();
  const reportIssue = useDisclosure();
  const editRecord = useDisclosure();

  const notFound =
    query.isError && query.error instanceof Error && query.error.message === RECORD_NOT_FOUND;

  const breadcrumb = (
    <Breadcrumb
      items={[
        { label: 'Overview', href: routes.doctor.overview },
        { label: 'Medical records', href: routes.doctor.medicalRecords },
        { label: query.data?.id ?? 'Record' },
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
            icon={FileQuestion}
            title="Record not found"
            headingLevel="h1"
            description={`No medical record with id "${recordId}" exists.`}
            action={
              <LinkButton href={routes.doctor.medicalRecords} variant="secondary">
                Back to medical records
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
            title="Couldn't load this record"
            headingLevel="h1"
            onRetry={() => void query.refetch()}
          />
        </PageSections>
      </PageContainer>
    );
  }

  const record = query.data;
  const hasSevereAllergy = record.allergies.some((allergy) => allergy.severity === 'severe');

  return (
    <PageContainer width="2xl">
      <PageSections>
        <ContentHeader
          title={record.id}
          icon={FolderHeart}
          tone="secondary"
          caption={`${record.visitType} · ${record.department} · ${formatDate(record.visitDate)} · ${record.patient.name}`}
          breadcrumb={breadcrumb}
          actions={
            <RecordQuickActions
              record={record}
              onAmend={() => actions.openAmend(record)}
              onEdit={editRecord.open}
              onReportIssue={reportIssue.open}
              onStatusChange={(status) => actions.changeStatus(record, status)}
              statusSubmitting={actions.statusSubmitting}
            />
          }
        />

        {record.allergies.length > 0 ? (
          <Alert
            variant={hasSevereAllergy ? 'error' : 'warning'}
            critical
            title={`Allergies: ${record.allergies
              .map(
                (allergy) =>
                  `${allergy.allergen} (${RECORD_ALLERGY_SEVERITY_META[
                    allergy.severity
                  ].label.toLowerCase()})`,
              )
              .join(' · ')}`}
          />
        ) : null}

        {/* P2 layout: clinical document (8) + summary column (4) on lg+;
            document first, summary after, when stacked (UX §5.2). */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="min-w-0 lg:col-span-8 xl:col-span-9">
            <Stack gap={6}>
              <RecordSectionCard title="Chief complaint">
                <p className="text-body-sm text-text-secondary">{record.chiefComplaint}</p>
              </RecordSectionCard>

              <RecordSectionCard title="History of present illness">
                <p className="text-body-sm text-text-secondary">{record.historyOfPresentIllness}</p>
              </RecordSectionCard>

              <RecordSectionCard title="Physical examination">
                <p className="text-body-sm text-text-secondary">{record.physicalExamination}</p>
              </RecordSectionCard>

              <RecordVitalsSection vitals={record.vitals} />

              <RecordDiagnosesSection record={record} />

              <RecordSectionCard title="Treatment plan">
                {record.treatmentPlan.length === 0 ? (
                  <EmptySectionNote>No treatment plan recorded.</EmptySectionNote>
                ) : (
                  <ol className="flex list-decimal flex-col gap-2 ps-5 text-body-sm text-text-secondary">
                    {record.treatmentPlan.map((step, index) => (
                      // Steps are free text and may repeat; the position is the identity.
                      <li key={index}>{step}</li>
                    ))}
                  </ol>
                )}
              </RecordSectionCard>

              <RecordMedicationsSection record={record} />

              <RecordAllergiesSection record={record} />

              <RecordNotesSection
                record={record}
                signedBy={actions.clinician}
                onSign={actions.openSign}
              />

              <RecordAttachmentsSection record={record} />
            </Stack>
          </div>

          <div className="min-w-0 lg:col-span-4 xl:col-span-3">
            <div className="lg:sticky lg:top-6">
              <Stack gap={6}>
                <RecordPatientSummaryCard record={record} />
                <RecordVisitInfoCard record={record} />
                <RecordTimelineSection record={record} />
                <RecordEditHistorySection recordId={record.id} />
              </Stack>
            </div>
          </div>
        </div>
      </PageSections>

      <SignNoteDialog
        open={actions.signing !== null}
        record={record}
        note={actions.signing}
        signedBy={actions.clinician}
        onClose={actions.closeSign}
        onConfirm={actions.confirmSign}
        submitting={actions.signSubmitting}
        errorMessage={actions.signError}
      />

      <AmendRecordDialog
        open={actions.amending !== null}
        record={actions.amending}
        author={actions.clinician}
        onClose={actions.closeAmend}
        onConfirm={actions.confirmAmend}
        submitting={actions.amendSubmitting}
        errorMessage={actions.amendError}
      />

      <EditRecordDialog open={editRecord.isOpen} record={record} onClose={editRecord.close} />

      <ReportRecordIssueDialog
        open={reportIssue.isOpen}
        record={record}
        onClose={reportIssue.close}
      />
    </PageContainer>
  );
}
