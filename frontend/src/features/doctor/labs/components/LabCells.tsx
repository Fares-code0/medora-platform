import { CheckCheck } from 'lucide-react';

import { StatusBadge } from '@/components/patterns';
import { Avatar, Badge } from '@/components/ui';
import { useT } from '@/i18n';
import { formatDate } from '@/utils/dates';

import {
  LAB_REVIEW_META,
  criticalResults,
  hasPreliminaryResults,
  reviewState,
} from '../model/review';
import {
  LAB_PRIORITY_META,
  LAB_RESULT_FLAG_META,
  LAB_STATUS_META,
  abnormalResultCount,
  type LabTest,
} from '../model/types';

/**
 * Small presentational cells shared by the table, the mobile cards, and
 * the detail page — one implementation per visual (no duplicated UI).
 */

export function LabPatientCell({ test }: { test: LabTest }) {
  return (
    <div className="flex items-center gap-3">
      <Avatar name={test.patient.name} size="sm" decorative />
      <div className="min-w-0">
        <p className="truncate text-body-sm font-medium text-text-primary">{test.patient.name}</p>
        <p className="text-caption text-text-tertiary">
          <span dir="ltr">
            {test.patient.age} · {test.patient.gender === 'female' ? 'F' : 'M'}
          </span>
        </p>
      </div>
    </div>
  );
}

export function LabTestNameCell({ test }: { test: LabTest }) {
  const abnormal = test.status === 'completed' ? abnormalResultCount(test) : 0;
  return (
    <div className="min-w-0">
      <p className="truncate text-body-sm font-medium text-text-primary">{test.testName}</p>
      <p className="text-caption text-text-tertiary">
        <span className="font-mono">{test.testCode}</span>
        {abnormal > 0 ? ` · ${String(abnormal)} abnormal` : ''}
      </p>
    </div>
  );
}

export function LabCategoryCell({ test }: { test: LabTest }) {
  return <Badge variant="neutral">{test.category}</Badge>;
}

export function LabStatusBadge({ test }: { test: LabTest }) {
  const t = useT();
  const meta = LAB_STATUS_META[test.status];
  return <StatusBadge status={meta.kind} label={t(meta.labelKey)} />;
}

export function LabPriorityBadge({ test }: { test: LabTest }) {
  const t = useT();
  const meta = LAB_PRIORITY_META[test.priority];
  return <StatusBadge status={meta.kind} label={t(meta.labelKey)} />;
}

/**
 * The flag column (UX §2.6's first column). It states the worst thing in the
 * result and how much of it — "3 of 24 abnormal" — because that is the pair a
 * doctor triages on. A clear result gets a quiet outline badge rather than a
 * dash: "checked, nothing out of range" is information, and a dash reads as
 * "not looked at".
 */
export function LabFlagCell({ test }: { test: LabTest }) {
  const t = useT();
  if (test.results.length === 0) {
    return <span className="text-text-tertiary">—</span>;
  }

  // Entered but not released: no flag is shown as if it were final. The
  // detail page carries the values under a "Preliminary" notice.
  if (hasPreliminaryResults(test)) {
    return (
      <div className="min-w-0">
        <StatusBadge status="pending" label="Preliminary" />
        <p className="mt-1 text-caption text-text-tertiary">Not yet released</p>
      </div>
    );
  }

  const critical = criticalResults(test);
  const abnormal = abnormalResultCount(test);
  const worst = critical[0] ?? test.results.find((result) => result.flag !== 'normal') ?? null;

  return (
    <div className="min-w-0">
      <StatusBadge
        status={worst === null ? 'normal' : LAB_RESULT_FLAG_META[worst.flag].kind}
        label={t(worst === null ? 'lab.flag.normal' : LAB_RESULT_FLAG_META[worst.flag].labelKey)}
      />
      <p className="mt-1 text-caption text-text-tertiary">
        {abnormal === 0
          ? `${String(test.results.length)} within range`
          : `${String(abnormal)} of ${String(test.results.length)} abnormal`}
      </p>
    </div>
  );
}

/**
 * The review column (UX §2.6). Only the state that needs a doctor gets a
 * badge — see `LAB_REVIEW_META`. A reviewed result renders its attribution
 * instead, which is what an auditor and a covering colleague actually need
 * ("who cleared this, and when"), and which a green pill would not carry.
 */
export function LabReviewCell({ test }: { test: LabTest }) {
  const state = reviewState(test);
  const meta = LAB_REVIEW_META[state];

  if (meta.kind !== null) {
    return (
      <StatusBadge
        status={meta.kind}
        label={criticalResults(test).length > 0 ? 'Critical — review' : meta.label}
      />
    );
  }

  if (state === 'reviewed' && test.review !== null) {
    return (
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-body-sm text-text-secondary">
          <CheckCheck aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={1.75} />
          Reviewed
        </p>
        <p className="truncate text-caption text-text-tertiary">
          {test.review.reviewedBy} · {formatDate(test.review.reviewedAt)}
        </p>
      </div>
    );
  }

  return <span className="text-text-tertiary">{meta.label}</span>;
}
