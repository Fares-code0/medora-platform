import { FlaskConical } from 'lucide-react';
import { useParams } from 'react-router-dom';

import { EmptyState, ErrorState, Skeleton } from '@/components/feedback';
import { ContentHeader, PageContainer, PageSections, Stack } from '@/components/layout';
import { Breadcrumb, Card, LinkButton } from '@/components/ui';
import { routes } from '@/routes';
import { formatDate } from '@/utils/dates';

import { LAB_NOT_FOUND, useLabTestQuery, useLabTestsQuery } from '../api/useLabTestsQuery';
import { AnalyteTrendDrawer } from '../components/AnalyteTrendDrawer';
import { AnnotateResultDialog } from '../components/AnnotateResultDialog';
import { AttachToRecordDialog } from '../components/AttachToRecordDialog';
import { LabAnnotationsSection } from '../components/detail/LabAnnotationsSection';
import { LabAttachmentsSection } from '../components/detail/LabAttachmentsSection';
import { LabInterpretationSection } from '../components/detail/LabInterpretationSection';
import { LabOrderedByCard } from '../components/detail/LabOrderedByCard';
import { LabPatientSummaryCard } from '../components/detail/LabPatientSummaryCard';
import { LabQuickActions } from '../components/detail/LabQuickActions';
import { LabResultsSection } from '../components/detail/LabResultsSection';
import { LabReviewSection } from '../components/detail/LabReviewSection';
import { LabSpecimenSection } from '../components/detail/LabSpecimenSection';
import { LabTestInfoCard } from '../components/detail/LabTestInfoCard';
import { LabTimelineSection } from '../components/detail/LabTimelineSection';
import { MarkReviewedDialog } from '../components/MarkReviewedDialog';
import { useLabReviewActions } from '../hooks/useLabReviewActions';
import { labService } from '../service';

/**
 * Lab result detail — the P2 clinical document page:
 * review/results/interpretation/attachments in the main column,
 * patient/test/order/specimen/timeline context in the sticky summary column.
 * Critical flags surface at the top of the results section (UX 1.5: critical
 * data is never buried).
 *
 * **No longer read-only.** D-11 gave it the review loop, D-13 the per-analyte
 * trend, and D-14 attach-to-record — all three through
 * `useLabReviewActions`, the same hook the list page uses, so a result cannot
 * behave one way in the table and another on its own page.
 *
 * The trend drawer needs the patient's *other* results, which this page's
 * single-result query does not have, so the list query is read alongside it.
 * They share a cache, so this costs one fetch on a cold load and nothing at
 * all when the doctor arrived from the list.
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

export function LabDetailPage() {
  const { labId = '' } = useParams();
  const query = useLabTestQuery(labId);
  const allTests = useLabTestsQuery();
  const actions = useLabReviewActions();

  const notFound =
    query.isError && query.error instanceof Error && query.error.message === LAB_NOT_FOUND;

  const breadcrumb = (
    <Breadcrumb
      items={[
        { label: 'Overview', href: routes.doctor.overview },
        { label: 'Labs', href: routes.doctor.labs },
        { label: query.data?.id ?? 'Result' },
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
            icon={FlaskConical}
            title="Lab result not found"
            headingLevel="h1"
            description={`No laboratory test with id "${labId}" exists.`}
            action={
              <LinkButton href={routes.doctor.labs} variant="secondary">
                Back to labs
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
            title="Couldn't load this lab result"
            headingLevel="h1"
            onRetry={() => void query.refetch()}
          />
        </PageSections>
      </PageContainer>
    );
  }

  const test = query.data;

  return (
    <PageContainer width="2xl">
      <PageSections>
        <ContentHeader
          title={test.id}
          icon={FlaskConical}
          tone="info"
          // Shown: the caption names the patient above the document, and the
          // patient summary card stacks after it below lg.
          showCaption
          caption={`${test.testName} · ${test.category} · ${formatDate(test.requestedDate)} · ${test.patient.name}`}
          breadcrumb={breadcrumb}
          actions={
            <LabQuickActions
              test={test}
              onMarkReviewed={() => actions.openReview(test)}
              onViewTrend={() => actions.openTrend(test, null)}
            />
          }
        />

        {/* P2 layout: clinical document (8) + summary column (4) on lg+;
            document first, summary after, when stacked (UX §5.2). */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="min-w-0 lg:col-span-8 xl:col-span-9">
            <Stack gap={6}>
              {/*
               * Review leads the document. It is the only section that says
               * whether anything is still owed on this result, and on a
               * critical value that is the first thing a reader needs.
               */}
              <LabReviewSection test={test} onAttach={() => actions.openAttach(test)} />
              <LabResultsSection
                test={test}
                onViewTrend={(analyte) => actions.openTrend(test, analyte)}
              />
              <LabInterpretationSection test={test} />
              <LabSpecimenSection test={test} />
              <LabAttachmentsSection test={test} />
              <LabAnnotationsSection
                test={test}
                onAnnotate={
                  labService.capabilities.annotations ? () => actions.openAnnotate(test) : null
                }
              />
            </Stack>
          </div>

          <div className="min-w-0 lg:col-span-4 xl:col-span-3">
            <div className="lg:sticky lg:top-6">
              <Stack gap={6}>
                <LabPatientSummaryCard test={test} />
                <LabTestInfoCard test={test} />
                <LabOrderedByCard test={test} />
                <LabTimelineSection test={test} />
              </Stack>
            </div>
          </div>
        </div>
      </PageSections>

      <MarkReviewedDialog
        open={actions.reviewing !== null}
        test={actions.reviewing}
        reviewer={actions.reviewer}
        onClose={actions.closeReview}
        onConfirm={actions.confirmReview}
        submitting={actions.reviewSubmitting}
        errorMessage={actions.reviewError}
      />

      <AnnotateResultDialog
        open={actions.annotating !== null}
        test={actions.annotating}
        author={actions.reviewer}
        onClose={actions.closeAnnotate}
        onConfirm={actions.confirmAnnotate}
        submitting={actions.annotateSubmitting}
        errorMessage={actions.annotateError}
      />

      <AttachToRecordDialog
        open={actions.attaching !== null}
        test={actions.attaching}
        attachedBy={actions.reviewer}
        existing={actions.existingAttachments}
        onClose={actions.closeAttach}
        onConfirm={actions.confirmAttach}
        submitting={actions.attachSubmitting}
        errorMessage={actions.attachError}
      />

      {actions.trending !== null ? (
        <AnalyteTrendDrawer
          open
          onClose={actions.closeTrend}
          tests={allTests.data ?? [test]}
          patientId={test.patient.id}
          patientName={test.patient.name}
          initialAnalyte={actions.trending.analyte}
        />
      ) : null}
    </PageContainer>
  );
}
