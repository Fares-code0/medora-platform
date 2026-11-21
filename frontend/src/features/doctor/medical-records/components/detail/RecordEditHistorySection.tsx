import { Button } from '@/components/ui';
import { formatDate, formatTime } from '@/utils/dates';

import { useRecordVersionsQuery } from '../../api/useMedicalRecordsQuery';

import { EmptySectionNote, RecordSectionCard } from './RecordSectionCard';

/**
 * Edit history (API §6.8, DEC-004) — every edit to the record's fields, with
 * who made it, when, and the before/after values the server recorded.
 *
 * The values are rendered as the server wrote them, never re-derived: this
 * is an audit view, and a client that "tidied" a before-value would be
 * rewriting the record of what changed. A field the server reports without a
 * before/after pair is listed by name only. An edit's reason is shown when
 * the editor gave one (BR-DEC-004); it is optional, so most versions have
 * none and say nothing about it.
 *
 * The server does not diff the record's lists. It names the ones an edit
 * replaced under one `children` key — `["diagnoses", "treatmentPlan"]` — and
 * the history says which were replaced, in words, rather than printing the
 * key.
 */

const FIELD_LABEL: Readonly<Record<string, string>> = {
  visitDate: 'Visit date',
  visitType: 'Visit type',
  department: 'Department',
  priority: 'Priority',
  chiefComplaint: 'Chief complaint',
  historyOfPresentIllness: 'History of present illness',
  physicalExamination: 'Physical examination',
  followUpDate: 'Follow-up date',
  diagnoses: 'Diagnoses',
  treatmentPlan: 'Treatment plan',
  medications: 'Medications',
  allergies: 'Allergies',
};

function show(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.length === 0 ? '—' : value.map((entry) => show(entry)).join(', ');
  }
  return JSON.stringify(value);
}

/** The lists an edit replaced, when the server names them (`children`). */
function replacedLists(field: string, value: unknown): readonly string[] | null {
  if (field !== 'children' || !Array.isArray(value)) return null;
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function isBeforeAfter(value: unknown): value is { before: unknown; after: unknown } {
  return typeof value === 'object' && value !== null && 'before' in value && 'after' in value;
}

export function RecordEditHistorySection({ recordId }: { recordId: string }) {
  const query = useRecordVersionsQuery(recordId);

  return (
    <RecordSectionCard title="Edit history">
      {query.isPending ? (
        <EmptySectionNote>Loading edit history…</EmptySectionNote>
      ) : query.isError ? (
        <div className="flex flex-wrap items-center gap-2">
          <p role="alert" className="text-body-sm text-error">
            Couldn&rsquo;t load the edit history.
          </p>
          <Button size="sm" variant="secondary" onClick={() => void query.refetch()}>
            Retry
          </Button>
        </div>
      ) : query.data.length === 0 ? (
        <EmptySectionNote>No edits recorded. The record is as it was created.</EmptySectionNote>
      ) : (
        <ol className="flex flex-col gap-4">
          {query.data.map((version) => (
            <li key={version.version} className="flex flex-col gap-1">
              <p className="text-body-sm font-semibold text-text-primary">
                Version {version.version} · {version.actor}
              </p>
              <p className="text-caption text-text-tertiary tabular-nums">
                {formatDate(version.changedAt)} · {formatTime(version.changedAt)}
              </p>
              {version.summary === null ? null : (
                <p className="text-body-sm text-text-secondary">{version.summary}</p>
              )}
              {version.reason === null ? null : (
                <p className="whitespace-pre-line break-words text-body-sm text-text-primary">
                  <span className="font-medium">Reason:</span> {version.reason}
                </p>
              )}
              <dl className="mt-1 flex flex-col gap-2">
                {Object.entries(version.changes).map(([field, change]) => {
                  const lists = replacedLists(field, change);
                  return (
                    <div key={field} className="rounded-control border border-border p-2">
                      <dt className="text-caption font-medium text-text-secondary">
                        {lists === null ? (FIELD_LABEL[field] ?? field) : 'Lists replaced'}
                      </dt>
                      {lists !== null ? (
                        <dd className="mt-1 text-body-sm text-text-primary">
                          {lists.map((list) => FIELD_LABEL[list] ?? list).join(', ')}
                        </dd>
                      ) : isBeforeAfter(change) ? (
                        <dd className="mt-1 grid grid-cols-1 gap-1 text-body-sm sm:grid-cols-2">
                          <span className="whitespace-pre-line break-words text-text-tertiary line-through">
                            <span className="sr-only">Before: </span>
                            {show(change.before)}
                          </span>
                          <span className="whitespace-pre-line break-words text-text-primary">
                            <span className="sr-only">After: </span>
                            {show(change.after)}
                          </span>
                        </dd>
                      ) : (
                        <dd className="mt-1 text-body-sm text-text-secondary">Changed</dd>
                      )}
                    </div>
                  );
                })}
              </dl>
            </li>
          ))}
        </ol>
      )}
    </RecordSectionCard>
  );
}
