import type { ReactNode } from 'react';

import { Grid, Stack } from '@/components/layout';
import { StatusBadge } from '@/components/patterns';
import { Button, Card } from '@/components/ui';
import { formatDate } from '@/utils/dates';

import { STUDY_STATUS_META, type StudyCategory } from '../../model/profile-types';

/**
 * Study result cards — one Card per category with date/status rows.
 *
 * **The Lab Results tab no longer uses this** (D-05): it reads the real
 * orders from `shared-domain/lab-studies` through `PatientLabStudiesTab`.
 * What remains here is imaging, and imaging has no source anywhere in the
 * app — no radiology feature, no PACS adapter, no report to open. So the
 * view action became optional rather than being pointed at a substitute:
 * it previously opened a generated PDF built from the patient's name and
 * assigned doctor, which is a document that looks like a radiology report
 * and contains none of one. A caller with no report to show passes no
 * `onView` and a `notice` saying why.
 */
export interface StudyCategoriesTabProps {
  categories: readonly StudyCategory[];
  /** e.g. "View report" (imaging). Omit when there is nothing to open. */
  actionLabel?: string;
  /** Omit to render the list without a per-study action. */
  onView?: ((studyName: string) => void) | undefined;
  /** Explains an absent action, above the cards. */
  notice?: ReactNode;
}

export function StudyCategoriesTab({
  categories,
  actionLabel,
  onView,
  notice,
}: StudyCategoriesTabProps) {
  return (
    <Stack gap={4}>
      {notice}
      <Grid columns={{ base: 1, md: 2 }} gap={4}>
      {categories.map((category) => (
        <Card
          key={category.id}
          padding="compact"
          title={category.label}
          subtitle={`${String(category.studies.length)} stud${category.studies.length === 1 ? 'y' : 'ies'}`}
        >
          {category.studies.length === 0 ? (
            <p className="text-body-sm text-text-tertiary">No studies yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {category.studies.map((study) => {
                const meta = STUDY_STATUS_META[study.status];
                return (
                  <li
                    key={study.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-body-sm font-medium text-text-primary">
                        {study.name}
                      </p>
                      <p className="text-caption text-text-tertiary tabular-nums">
                        {formatDate(study.date)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <StatusBadge status={meta.kind} label={meta.label} />
                      {onView !== undefined && actionLabel !== undefined ? (
                        <Button variant="ghost" size="sm" onClick={() => onView(study.name)}>
                          {actionLabel}
                        </Button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        ))}
      </Grid>
    </Stack>
  );
}
