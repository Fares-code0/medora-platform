import { useState } from 'react';

import { useSearchParams } from 'react-router-dom';

import { useCan } from '@/app/providers';
import { Alert } from '@/components/feedback';
import { Badge, Button, Chip, DataTable, type DataTableColumn, SearchInput, Select, type SelectOption } from '@/components/ui';
import { formatDate, formatTime } from '@/utils/dates';

import { GridEmpty, Panel } from '../components/primitives';
import { findCapability } from '../permissions';
import { MaskedIdentifier } from '../phi';

import { filterRows, sortRows } from './communications';
import type {
  CommunicationsDocument,
  ConversationFilters,
  ConversationRow,
  ConversationSort,
  ConversationStatus,
} from './communications.types';
import { ContentAccessDialog } from './ContentAccessDialog';

/**
 * Conversation logs — the metadata table (ADM-06B Task 8 · UX §3.6).
 *
 * Replaces Task 7's stub (a plain row list) with the real filterable,
 * sortable `DataGrid`. One thing carries over unedited: the request-access
 * affordance is gated on `communications.viewContent`, and without it this
 * tab renders the denial alert once above the table rather than a disabled
 * button on every row — forty disabled buttons teach nothing, one sentence
 * explains. Task 7's gate tests exercise exactly that behaviour and are
 * untouched by this change.
 *
 * **The doctor is named; the patient is masked — in the DOM, not just on
 * screen.** `row.patientName` exists on `ConversationRow` only to hand to
 * `MaskedIdentifier`; it is never interpolated into text, a `title`, or an
 * `aria-label` anywhere in this file. `MaskedIdentifier` renders a fixed-
 * width bullet string until a live PHI grant reveals it, so the cleartext
 * name is not merely hidden by CSS — it is not in the tree to find.
 *
 * `subjectLabel` is `Conversation ${row.id}`, deliberately non-identifying
 * (see the prop's own docstring): it groups a record's masked fields under
 * one justification without that justification prompt itself naming who it
 * is for.
 *
 * `query`, `status`, `flagged` and `sort` are URL-owned alongside `?tab=`,
 * the ADM-01/ADM-07 house pattern — every param is read through a validated
 * parser with a concrete fallback (never a cast), so a hand-edited URL can't
 * put the table into a state its own unions call impossible.
 *
 * **Task 9 addition:** the row action now opens `ContentAccessDialog`. Which
 * row is prompting lives here, as plain local state — the dialog itself
 * decides category and reason, and only calls `useContentAccess().request`
 * once both are valid. This tab holds no grant of its own.
 */

const STATUS_VALUES = ['all', 'active', 'unanswered', 'archived'] as const;
const FLAGGED_VALUES = ['all', 'flagged', 'unflagged'] as const;
const SORT_VALUES = ['recent', 'oldest', 'most-messages', 'most-flags'] as const;

function parseStatus(value: string | null): ConversationStatus | 'all' {
  return STATUS_VALUES.find((status) => status === value) ?? 'all';
}

function parseFlagged(value: string | null): 'all' | 'flagged' | 'unflagged' {
  return FLAGGED_VALUES.find((flag) => flag === value) ?? 'all';
}

function parseSort(value: string | null): ConversationSort {
  return SORT_VALUES.find((sort) => sort === value) ?? 'recent';
}

const STATUS_OPTIONS: readonly SelectOption[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'unanswered', label: 'Unanswered' },
  { value: 'archived', label: 'Archived' },
];

const SORT_OPTIONS: readonly SelectOption[] = [
  { value: 'recent', label: 'Most recent activity' },
  { value: 'oldest', label: 'Oldest activity' },
  { value: 'most-messages', label: 'Most messages' },
  { value: 'most-flags', label: 'Most flags' },
];

interface StatusBadgeMeta {
  readonly label: string;
  readonly variant: 'success' | 'warning' | 'neutral';
}

const STATUS_BADGE: Record<ConversationStatus, StatusBadgeMeta> = {
  active: { label: 'Active', variant: 'success' },
  unanswered: { label: 'Unanswered', variant: 'warning' },
  archived: { label: 'Archived', variant: 'neutral' },
};

export function ConversationLogsTab({ document }: { document: CommunicationsDocument }) {
  const can = useCan();
  const canViewContent = can('communications.viewContent');
  const contentCapability = findCapability('communications.viewContent');

  // Which row's "Request content access" is currently prompting for a
  // justification — at most one at a time, and local to this tab. The
  // provider itself holds no notion of a pending dialog; only a live grant
  // once one has actually been justified and logged.
  const [pendingConversationId, setPendingConversationId] = useState<string | null>(null);

  const [searchParams, setSearchParams] = useSearchParams();
  const filters: ConversationFilters = {
    query: searchParams.get('query') ?? '',
    status: parseStatus(searchParams.get('status')),
    flagged: parseFlagged(searchParams.get('flagged')),
  };
  const sort = parseSort(searchParams.get('sort'));

  const setParam = (key: 'query' | 'status' | 'flagged' | 'sort', value: string) => {
    const params = new URLSearchParams(searchParams);
    params.set(key, value);
    setSearchParams(params, { replace: true });
  };

  const rows = sortRows(filterRows(document.rows, filters), sort);

  const columns: readonly DataTableColumn<ConversationRow>[] = [
    {
      id: 'participants',
      header: 'Participants',
      cell: (row) => (
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate font-medium text-text-primary">{row.doctorName}</span>
          {row.patientId !== null && row.patientName !== null ? (
            <MaskedIdentifier
              subjectId={row.patientId}
              subjectLabel={`Conversation ${row.id}`}
              kind="name"
              value={row.patientName}
              className="text-caption text-text-tertiary"
            />
          ) : null}
        </div>
      ),
    },
    {
      id: 'started',
      header: 'Started',
      hideBelowMd: true,
      cell: (row) => (
        <span className="whitespace-nowrap text-text-tertiary">
          {formatDate(row.startedAt)} · {formatTime(row.startedAt)}
        </span>
      ),
    },
    {
      id: 'lastActivity',
      header: 'Last activity',
      cell: (row) => (
        <span className="whitespace-nowrap text-text-tertiary">
          {formatDate(row.lastActivityAt)} · {formatTime(row.lastActivityAt)}
        </span>
      ),
    },
    {
      id: 'messages',
      header: 'Messages',
      align: 'right',
      hideBelowMd: true,
      cell: (row) => <span className="tabular-nums">{row.messageCount}</span>,
    },
    {
      id: 'status',
      header: 'Status',
      cell: (row) => (
        <Badge variant={STATUS_BADGE[row.status].variant}>{STATUS_BADGE[row.status].label}</Badge>
      ),
    },
    {
      id: 'flags',
      header: 'Flags',
      align: 'right',
      cell: (row) =>
        row.flagCount > 0 ? (
          <Badge variant="warning">{row.flagCount}</Badge>
        ) : (
          <span className="text-text-tertiary">—</span>
        ),
    },
    {
      id: 'actions',
      header: '',
      align: 'right',
      cell: (row) =>
        canViewContent ? (
          // The visible label names the action; the accessible name also
          // names the conversation, never the patient — ADM-04's rule for
          // why a control's name (announced aloud, written to logs) can't
          // carry a person's identity.
          <Button
            variant="secondary"
            size="sm"
            aria-label={`Request content access for conversation ${row.id}`}
            onClick={() => setPendingConversationId(row.id)}
          >
            Request content access
          </Button>
        ) : null,
    },
  ];

  return (
    <Panel
      title="Conversation logs"
      description="Participants, timestamps and volume — never message bodies, until content access is granted."
      headingAs="h2"
    >
      <div className="flex flex-col gap-4">
        {!canViewContent ? (
          <Alert variant="warning" title="Content access is restricted">
            {contentCapability?.lockReason ??
              'Reading message content requires the content-access permission.'}
          </Alert>
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="sm:flex-1 sm:basis-64">
            <SearchInput
              value={filters.query}
              onChange={(event) => setParam('query', event.target.value)}
              onClear={() => setParam('query', '')}
              placeholder="Search doctor or conversation id"
              aria-label="Search conversations"
            />
          </div>
          <Select
            options={STATUS_OPTIONS}
            value={filters.status}
            onChange={(value) => setParam('status', parseStatus(value))}
            aria-label="Filter by status"
            containerClassName="sm:w-44"
          />
          <Chip
            label="Flagged only"
            selected={filters.flagged === 'flagged'}
            onSelect={() =>
              setParam('flagged', filters.flagged === 'flagged' ? 'all' : 'flagged')
            }
          />
          <Select
            options={SORT_OPTIONS}
            value={sort}
            onChange={(value) => setParam('sort', parseSort(value))}
            aria-label="Sort order"
            containerClassName="sm:w-48"
          />
        </div>

        <DataTable
          bare
          zebra={false}
          density="admin"
          stickyHeader={false}
          headerVoice="overline"
          columns={columns}
          rows={rows}
          getRowId={(row) => row.id}
          caption="Conversation logs"
          emptyState={<GridEmpty>No conversations match these filters.</GridEmpty>}
        />
      </div>

      <ContentAccessDialog
        open={pendingConversationId !== null}
        conversationId={pendingConversationId}
        onClose={() => setPendingConversationId(null)}
      />
    </Panel>
  );
}
