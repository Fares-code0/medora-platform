import { FlaskConical } from 'lucide-react';
import { Link } from 'react-router-dom';

import { EmptyState, ErrorState, Skeleton } from '@/components/feedback';
import { Grid } from '@/components/layout';
import { StatusBadge } from '@/components/patterns';
import { Badge, Card } from '@/components/ui';
import {
  LAB_STATUS_META,
  groupPatientLabStudies,
  usePatientLabStudiesQuery,
  type PatientLabStudy,
} from '@/features/shared-domain/lab-studies';
import { routes } from '@/routes';
import { formatDate } from '@/utils/dates';

/**
 * The patient profile's "Lab results" tab (D-05).
 *
 * Before this, the tab rendered invented study cards from the profile's own
 * mock generator while the real orders sat in the labs feature — "the same
 * data exists two floors away and isn't shared". It now reads the shared
 * `lab-studies` store, the same one the Labs screen reads and writes, so a
 * result marked reviewed there stops saying "Awaiting review" here.
 *
 * **It lists; it does not read.** Every row links into the labs feature's own
 * detail route rather than rendering values, because reading a result is that
 * feature's job (the report viewer, the trend, the review flow) and a second
 * renderer here is a second thing to keep correct. What the tab does carry is
 * the three facts a doctor scans a history for: when, whether anything was
 * out of range, and whether it has been reviewed.
 */

export interface PatientLabStudiesTabProps {
  patientId: string;
}

function StudyRow({ study }: { study: PatientLabStudy }) {
  const status = LAB_STATUS_META[study.status];
  const released = study.resultCount > 0;

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="truncate text-body-sm font-medium text-text-primary">
          {study.testName}{' '}
          {/*
            A lab test code is read character by character, so it is DATA, not
            glanceable metadata, and ADR-0001 §10 keeps it out of the faintest
            tint. `font-normal` still steps it back from the test name beside
            it — the de-emphasis comes from weight, not from a tint a reader
            has to squint through.
          */}
          <span className="font-normal text-text-secondary">({study.testCode})</span>
        </p>
        <p className="text-caption text-text-tertiary tabular-nums">
          {formatDate(study.date)}
          {released
            ? ` · ${String(study.resultCount)} analyte${study.resultCount === 1 ? '' : 's'}`
            : ''}
        </p>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {study.hasCriticalResult ? (
          <StatusBadge status="critical" label="Critical" />
        ) : study.abnormalCount > 0 ? (
          <StatusBadge
            status="expiring"
            label={`${String(study.abnormalCount)} abnormal`}
          />
        ) : null}

        {/*
         * Review state is shown only once a result exists. An order still in
         * the lab is not "awaiting review" — nobody can review what has not
         * been released, and saying so would put it on the doctor's mental
         * list of outstanding work.
         */}
        {released ? (
          study.reviewed ? (
            <Badge variant="success">Reviewed</Badge>
          ) : (
            <Badge variant="warning">Awaiting review</Badge>
          )
        ) : (
          <StatusBadge status={status.kind} label={status.label} />
        )}

        <Link
          to={`${routes.doctor.labs}/${study.labId}`}
          className="text-body-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:underline"
        >
          Open result
        </Link>
      </div>
    </li>
  );
}

export function PatientLabStudiesTab({ patientId }: PatientLabStudiesTabProps) {
  const { data, isPending, isError, refetch } = usePatientLabStudiesQuery(patientId);

  if (isPending) {
    return (
      <Grid columns={{ base: 1, md: 2 }} gap={4}>
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </Grid>
    );
  }

  if (isError) {
    return (
      <ErrorState
        title="Lab results could not be loaded"
        description="The laboratory record for this patient is unavailable."
        onRetry={() => void refetch()}
      />
    );
  }

  const groups = groupPatientLabStudies(data.studies);

  if (groups.length === 0) {
    return (
      <EmptyState
        icon={FlaskConical}
        title="No lab work on record"
        description="Nothing has been ordered for this patient yet."
      />
    );
  }

  return (
    <Grid columns={{ base: 1, md: 2 }} gap={4}>
      {data.truncated ? (
        <p className="text-body-sm text-text-secondary md:col-span-2">
          Showing the most recent studies only — older ones are on the Labs screen.
        </p>
      ) : null}
      {groups.map((group) => (
        <Card
          key={group.id}
          padding="compact"
          title={group.label}
          subtitle={`${String(group.studies.length)} stud${group.studies.length === 1 ? 'y' : 'ies'}`}
        >
          <ul className="flex flex-col divide-y divide-border">
            {group.studies.map((study) => (
              <StudyRow key={study.labId} study={study} />
            ))}
          </ul>
        </Card>
      ))}
    </Grid>
  );
}
