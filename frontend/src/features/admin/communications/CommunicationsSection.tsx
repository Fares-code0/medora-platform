import { useSearchParams } from 'react-router-dom';

import { useCan } from '@/app/providers';
import { Alert } from '@/components/feedback';
import { Tabs, type TabItem } from '@/components/ui';
import type { Permission } from '@/types/auth';

import { AsyncSection } from '../components/primitives';
import { SectionShell } from '../components/SectionShell';
import { findCapability } from '../permissions';

import { useCommunicationsDocument } from './communications.queries';
import { ConversationLogsTab } from './ConversationLogsTab';
import { OverviewTab } from './OverviewTab';
import { SafetyFlagsTab } from './SafetyFlagsTab';

/**
 * Communication Monitoring — section shell and capability gate (ADM-06B
 * Task 7 · UX §3.6).
 *
 * **The capability gate is defended by the capability, not by a loading
 * state.** A sibling feature (ADM-01) shipped a test that asserted an
 * affordance was absent, and it passed only because the whole table was
 * still loading — the gate itself had been removed and nothing noticed
 * until a second fix round. Every gate test in this feature therefore waits
 * for real content to land before asserting an affordance is missing, and
 * every gate below reads `useCan()` directly rather than inferring "no
 * access" from "no data yet".
 *
 * The three capabilities gate three different things: `viewMetadata` gates
 * this whole section, `viewContent` gates the request-access affordance
 * inside Conversation Logs, and `resolveFlags` gates the resolve actions
 * inside Safety Flags. The tabs themselves always render once the section is
 * open — an administrator holding metadata only still sees the flags queue,
 * read-only.
 */

const TABS = ['overview', 'logs', 'flags'] as const;
type CommunicationsTab = (typeof TABS)[number];

const TAB_ITEMS: readonly TabItem[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'logs', label: 'Conversation logs' },
  { value: 'flags', label: 'Safety flags' },
];

/**
 * Validated, never cast. ADM-07 shipped `value as SortOrder` here and it
 * became a review finding: an unchecked cast lets a hand-edited URL put the
 * component into a state its own union says is impossible.
 */
function parseTab(value: string | null): CommunicationsTab {
  return TABS.find((tab) => tab === value) ?? 'overview';
}

/**
 * A capability denial that quotes the permission matrix's own reason rather
 * than retyping it, so the matrix and the screen cannot drift apart. Falls
 * back to a generic message for capabilities (like `viewMetadata`) that
 * carry no `lockReason` of their own.
 */
function AccessDeniedAlert({ capability }: { capability: Permission }) {
  const meta = findCapability(capability);
  const reason =
    meta?.lockReason ??
    `Your role does not include the "${meta?.label ?? capability}" permission.`;

  return (
    <Alert variant="warning" title="You don't have permission to view this section">
      {reason}
    </Alert>
  );
}

export function CommunicationsSection() {
  const can = useCan();
  const [searchParams, setSearchParams] = useSearchParams();
  const document = useCommunicationsDocument();

  if (!can('communications.viewMetadata')) {
    return (
      <SectionShell slug="communications">
        <AccessDeniedAlert capability="communications.viewMetadata" />
      </SectionShell>
    );
  }

  const tab = parseTab(searchParams.get('tab'));
  const setTab = (next: string) => {
    const params = new URLSearchParams(searchParams);
    params.set('tab', next);
    setSearchParams(params, { replace: true });
  };

  return (
    <SectionShell
      slug="communications"
      toolbar={
        <Tabs
          aria-label="Communication monitoring sections"
          value={tab}
          onValueChange={setTab}
          items={TAB_ITEMS}
        />
      }
    >
      <AsyncSection
        isLoading={document.isLoading}
        isError={document.isError}
        onRetry={() => void document.refetch()}
      >
        {document.data === undefined ? null : (
          <>
            {tab === 'overview' ? <OverviewTab overview={document.data.overview} /> : null}
            {tab === 'logs' ? <ConversationLogsTab document={document.data} /> : null}
            {tab === 'flags' ? <SafetyFlagsTab document={document.data} /> : null}
          </>
        )}
      </AsyncSection>
    </SectionShell>
  );
}
