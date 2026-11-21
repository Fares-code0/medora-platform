import { useState } from 'react';

import { useAuth, useCan, useToast } from '@/app/providers';
import { Alert } from '@/components/feedback';
import { Badge, Button, Chip, LinkButton, type BadgeVariant } from '@/components/ui';
import { routes } from '@/routes';
import { formatDate, formatTime } from '@/utils/dates';

import { Panel } from '../components/primitives';

import { maskExcerpt } from './communications';
import { useSetFlagStatusMutation } from './communications.queries';
import type { CommunicationsDocument, FlagCategory, FlagStatus, SafetyFlag } from './communications.types';
import { ALL_FLAG_CATEGORIES, FLAG_CATEGORY_LABEL } from './flag-rules';
import { FlagResolveDialog } from './FlagResolveDialog';

/**
 * Safety flags — the real triage queue (ADM-06B Task 11 · UX §3.6).
 *
 * Replaces Task 7's stub (a flat list with a bare "Resolve" button) with a
 * filterable, conversation-grouped queue and the actual status/resolution
 * workflow. The capability gate carries over unedited: actions render only
 * with `communications.resolveFlags`, and Task 7's negative gate test
 * (`shows flags read-only without resolveFlags`) still exercises exactly
 * that — an administrator holding `viewMetadata` only still sees the queue,
 * just without the buttons.
 *
 * **Three things this queue deliberately does not do**, each one a way an
 * "obviously helpful" addition would defeat something ADM-06B is built to
 * protect:
 *
 * 1. It renders `flag.excerpt` — through `maskExcerpt` (§6.4), never
 *    verbatim — and nothing else about the message: no neighbouring
 *    lines, no thread preview. `SafetyFlag` has no `body` field (see
 *    `communications.types.ts`); a flag card that quietly grew context
 *    would be a way around the content-access gate, and one that quoted
 *    the excerpt unmasked would be a leak of exactly the kind
 *    `phi-wrong-channel` exists to catch, one tab wider than the thread
 *    it came from.
 * 2. "View conversation" links to the metadata row
 *    (`/admin/communications?tab=logs&query=<id>`), never to the viewer.
 *    A one-click path from a flag straight into message content is the
 *    same bypass in a different shape.
 * 3. It never suspends anyone itself. "Escalate for suspension" (in
 *    `FlagResolveDialog`) resolves the flag and navigates to the account's
 *    own suspension flow; see that file for why a second implementation of
 *    suspension policy here would be a hardening fix that reaches one copy
 *    and misses the other.
 *
 * **The banner above the filters is a requirement, not decoration (§6.3).**
 * `flag-rules.ts` documents the measured recall on unseen phrasing — one
 * review round scored 1 of 22 fresh emergency wordings after the vocabulary
 * had already been widened to catch the previous round's 13. An
 * administrator who believes this queue catches every emergency is worse
 * off than one who knows it does not: the false assurance is the hazard,
 * not the missed keyword. So this stays visible on every visit to the tab,
 * not a tooltip a reviewer can go a whole session without opening.
 */

interface FilterOption<T> {
  readonly value: T;
  readonly label: string;
}

// "Closed", not "Resolved": every per-flag action here is named "Resolve…"
// or "Mark under review", and the queue tests select on `/^resolve/i` and
// `/^mark/i` — a filter chip labelled "Resolved" would collide with the
// first and get clicked in place of an actual flag's action.
const STATUS_FILTERS: readonly FilterOption<FlagStatus | 'all'>[] = [
  { value: 'open', label: 'Open' },
  { value: 'under-review', label: 'Under review' },
  { value: 'resolved', label: 'Closed' },
  { value: 'all', label: 'All statuses' },
];

const CATEGORY_FILTERS: readonly FilterOption<FlagCategory | 'all'>[] = [
  { value: 'all', label: 'All categories' },
  ...ALL_FLAG_CATEGORIES.map(
    (category): FilterOption<FlagCategory> => ({
      value: category,
      label: FLAG_CATEGORY_LABEL[category],
    }),
  ),
];

const FLAG_STATUS_BADGE: Record<FlagStatus, { readonly label: string; readonly variant: BadgeVariant }> = {
  open: { label: 'Open', variant: 'warning' },
  'under-review': { label: 'Under review', variant: 'info' },
  resolved: { label: 'Resolved', variant: 'success' },
};

interface FlagGroup {
  readonly conversationId: string;
  readonly flags: readonly SafetyFlag[];
}

/**
 * Newest flag first within a conversation, and conversations ordered by
 * their own newest flag — the thread that needs attention soonest leads.
 * "Grouped by conversation" is required by the brief and exercised by the
 * seeded corpus on purpose: two conversations carry flags, and one of them
 * (`cv-portal`) carries two, so a single-flag-per-conversation assumption
 * would already be wrong against the seed.
 */
function groupFlags(flags: readonly SafetyFlag[]): readonly FlagGroup[] {
  const byConversation = new Map<string, SafetyFlag[]>();
  for (const flag of flags) {
    const existing = byConversation.get(flag.conversationId);
    if (existing) existing.push(flag);
    else byConversation.set(flag.conversationId, [flag]);
  }

  const groups: FlagGroup[] = [];
  for (const [conversationId, groupedFlags] of byConversation) {
    const sorted = [...groupedFlags].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    groups.push({ conversationId, flags: sorted });
  }

  return groups.sort((a, b) => {
    const aNewest = a.flags[0]?.at ?? '';
    const bNewest = b.flags[0]?.at ?? '';
    return Date.parse(bNewest) - Date.parse(aNewest);
  });
}

/**
 * The verbatim empty state only applies to the default `open` filter — an
 * empty `open` queue is the good outcome the checkmark celebrates. The
 * other filters get a plain statement; there is nothing to celebrate about
 * an empty "resolved" list.
 */
function emptyStateLabel(status: FlagStatus | 'all'): string {
  switch (status) {
    case 'open':
      return 'No open flags ✓';
    case 'under-review':
      return 'No flags under review.';
    case 'resolved':
      return 'No resolved flags yet.';
    case 'all':
      return 'No flags match these filters.';
  }
}

export function SafetyFlagsTab({ document }: { document: CommunicationsDocument }) {
  const can = useCan();
  const canResolve = can('communications.resolveFlags');
  const { user } = useAuth();
  const { toast } = useToast();
  const actorName = user?.name ?? 'Administrator';

  const [statusFilter, setStatusFilter] = useState<FlagStatus | 'all'>('open');
  const [categoryFilter, setCategoryFilter] = useState<FlagCategory | 'all'>('all');
  const [resolvingFlag, setResolvingFlag] = useState<SafetyFlag | null>(null);

  const setStatus = useSetFlagStatusMutation();

  const rowsById = new Map(document.rows.map((row) => [row.id, row] as const));

  const filteredFlags = document.flags.filter(
    (flag) =>
      (statusFilter === 'all' || flag.status === statusFilter) &&
      (categoryFilter === 'all' || flag.category === categoryFilter),
  );
  const groups = groupFlags(filteredFlags);

  const markUnderReview = (flag: SafetyFlag) => {
    setStatus.mutate(
      { flagId: flag.id, status: 'under-review', decidedBy: actorName },
      {
        onError: (error) => {
          toast(
            error instanceof Error
              ? { variant: 'error', title: 'The flag could not be updated', description: error.message }
              : { variant: 'error', title: 'The flag could not be updated' },
          );
        },
      },
    );
  };

  return (
    <Panel title="Safety flags" description="Grouped by conversation, newest first." headingAs="h2">
      <div className="flex flex-col gap-4">
        <Alert variant="info" title="What automatic flagging does not do">
          Auto-detected flags come from a fixed list of keyword patterns, not a
          classifier — they catch only some ways of phrasing an emergency, a
          solicitation, or a leaked identifier, and miss many others by design.
          This queue is retrospective oversight, not clinical triage: a message
          that never gets flagged here is still sitting in the doctor&rsquo;s own
          inbox, in front of the clinician it was actually sent to.
        </Alert>

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {STATUS_FILTERS.map((entry) => (
              <Chip
                key={entry.value}
                label={entry.label}
                selected={statusFilter === entry.value}
                onSelect={() => setStatusFilter(entry.value)}
              />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {CATEGORY_FILTERS.map((entry) => (
              <Chip
                key={entry.value}
                label={entry.label}
                selected={categoryFilter === entry.value}
                onSelect={() => setCategoryFilter(entry.value)}
              />
            ))}
          </div>
        </div>

        {groups.length === 0 ? (
          <p className="text-body-sm text-text-tertiary">{emptyStateLabel(statusFilter)}</p>
        ) : (
          <div className="flex flex-col gap-4">
            {groups.map((group) => {
              const row = rowsById.get(group.conversationId);
              return (
                <div
                  key={group.conversationId}
                  className="overflow-hidden rounded-surface border border-border"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-sunken px-4 py-2.5">
                    <div className="flex min-w-0 items-center gap-2 text-body-sm">
                      <span className="truncate font-medium text-text-primary">
                        {row?.doctorName ?? 'Care team'}
                      </span>
                      <span className="text-text-tertiary">
                        · Conversation {group.conversationId}
                      </span>
                    </div>
                    <LinkButton
                      href={`${routes.admin.communications}?tab=logs&query=${encodeURIComponent(group.conversationId)}`}
                      variant="secondary"
                      size="sm"
                    >
                      View conversation
                    </LinkButton>
                  </div>
                  <ul className="flex flex-col divide-y divide-border">
                    {group.flags.map((flag) => (
                      <li key={flag.id} className="flex flex-col gap-2 p-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="warning">{FLAG_CATEGORY_LABEL[flag.category]}</Badge>
                          <Badge variant={flag.source === 'auto' ? 'neutral' : 'info'}>
                            {flag.source === 'auto' ? 'Auto-detected' : 'Reported by a user'}
                          </Badge>
                          <Badge variant={FLAG_STATUS_BADGE[flag.status].variant}>
                            {FLAG_STATUS_BADGE[flag.status].label}
                          </Badge>
                        </div>
                        <blockquote className="border-s-2 border-border-strong ps-3 text-body-sm text-text-secondary">
                          {/* Masked, not verbatim (§6.4) — any category can
                              name a patient, and this queue must never be
                              the wider-audience leak the mask on the
                              metadata table one tab over is there to
                              prevent. */}
                          &ldquo;{maskExcerpt(flag.excerpt)}&rdquo;
                        </blockquote>
                        <p className="text-caption text-text-tertiary">
                          {flag.authorLabel} · {formatDate(flag.at)} {formatTime(flag.at)}
                        </p>
                        {flag.note !== null ? (
                          <p className="text-caption text-text-tertiary">Decision: {flag.note}</p>
                        ) : null}
                        {canResolve && flag.status !== 'resolved' ? (
                          <div className="flex flex-wrap gap-2">
                            {flag.status === 'open' ? (
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => markUnderReview(flag)}
                                loading={setStatus.isPending && setStatus.variables?.flagId === flag.id}
                              >
                                Mark under review
                              </Button>
                            ) : null}
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={() => setResolvingFlag(flag)}
                            >
                              Resolve…
                            </Button>
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <FlagResolveDialog
        open={resolvingFlag !== null}
        flag={resolvingFlag}
        onClose={() => setResolvingFlag(null)}
      />
    </Panel>
  );
}
