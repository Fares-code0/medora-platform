import { Check, KeyRound, ShieldCheck, ShieldOff, ShieldX, X } from 'lucide-react';

import { Alert, EmptyState } from '@/components/feedback';
import { Badge, Button, DataTable, type DataTableColumn } from '@/components/ui';

import { Panel } from '../components/primitives';

import {
  activeGrants,
  formatDate,
  formatDateTime,
  GRANTEE_ROLE_LABEL,
  hasNoActiveAccess,
  revokedGrants,
  SCOPE_LABEL,
  SCOPE_VARIANT,
} from './patients';
import type { AccessGrant, AccessRequest, PatientAccount } from './patients.types';

/**
 * The medical-access grid (ADM-04 · UX §3.4, Permissions tab) — who can
 * open this patient's record, on whose authority, since when, and how much
 * of it they can see.
 *
 * It is three panels rather than one table because they answer three
 * different questions, and only one of them is a decision:
 *
 *  1. **Pending requests** — the work. Approving one is a grant of access
 *     to a medical record, so it sits at the top with the requester's own
 *     justification quoted, not summarised into a scope chip.
 *  2. **Active access** — the standing answer to "who can read this".
 *  3. **Access history** — every grant that has been withdrawn, with the
 *     reason and the administrator who withdrew it. §3.4 requires the
 *     historical entries, and they are the half an investigation reads: a
 *     grid that quietly deletes revoked rows can tell you who has access
 *     but never who *had* it.
 *
 * Nothing here can be changed without the account-management capability;
 * without it the panels are a read-only register, which is the correct
 * behaviour rather than a hidden tab.
 */

export interface AccessGridProps {
  patient: PatientAccount;
  canManage: boolean;
  busy: boolean;
  onApprove: (request: AccessRequest) => void;
  onDeny: (request: AccessRequest) => void;
  onRevoke: (grant: AccessGrant) => void;
}

export function AccessGrid({
  patient,
  canManage,
  busy,
  onApprove,
  onDeny,
  onRevoke,
}: AccessGridProps) {
  const active = activeGrants(patient);
  const history = revokedGrants(patient);

  const activeColumns: readonly DataTableColumn<AccessGrant>[] = [
    {
      id: 'grantee',
      header: 'Who has access',
      cell: (grant) => (
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-medium text-text-primary">{grant.granteeName}</span>
          <span className="text-caption text-text-tertiary">
            {GRANTEE_ROLE_LABEL[grant.granteeRole]}
          </span>
        </div>
      ),
    },
    {
      id: 'scope',
      header: 'Scope',
      cell: (grant) => (
        <Badge variant={SCOPE_VARIANT[grant.scope]}>{SCOPE_LABEL[grant.scope]}</Badge>
      ),
    },
    {
      id: 'grantedBy',
      header: 'Granted by',
      hideBelowMd: true,
      cell: (grant) => <span className="text-text-secondary">{grant.grantedBy}</span>,
    },
    {
      id: 'grantedAt',
      header: 'Since',
      hideBelowMd: true,
      cell: (grant) => (
        <span className="whitespace-nowrap text-text-tertiary">{formatDate(grant.grantedAt)}</span>
      ),
    },
    {
      id: 'actions',
      header: '',
      align: 'right',
      cell: (grant) =>
        canManage ? (
          <Button
            variant="ghost"
            size="sm"
            leadingIcon={ShieldOff}
            disabled={busy}
            onClick={() => onRevoke(grant)}
          >
            Revoke
          </Button>
        ) : null,
    },
  ];

  const historyColumns: readonly DataTableColumn<AccessGrant>[] = [
    {
      id: 'grantee',
      header: 'Who had access',
      cell: (grant) => (
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-text-primary">{grant.granteeName}</span>
          <span className="text-caption text-text-tertiary">
            {GRANTEE_ROLE_LABEL[grant.granteeRole]} · {SCOPE_LABEL[grant.scope]}
          </span>
        </div>
      ),
    },
    {
      id: 'window',
      header: 'Held',
      hideBelowMd: true,
      cell: (grant) => (
        <span className="whitespace-nowrap text-text-tertiary">
          {formatDate(grant.grantedAt)} — {grant.revokedAt ? formatDate(grant.revokedAt) : '—'}
        </span>
      ),
    },
    {
      id: 'revokedBy',
      header: 'Revoked by',
      hideBelowMd: true,
      cell: (grant) => <span className="text-text-secondary">{grant.revokedBy ?? '—'}</span>,
    },
    {
      id: 'reason',
      header: 'Reason',
      cell: (grant) => <span className="text-text-secondary">{grant.revocationReason ?? '—'}</span>,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {patient.accessRequests.length > 0 ? (
        <Panel
          title="Access requests"
          description="Approving one grants access to this medical record."
          icon={KeyRound}
          tone="warning"
        >
          <ul className="flex flex-col gap-3">
            {patient.accessRequests.map((request) => (
              <li
                key={request.id}
                className="flex flex-col gap-3 rounded-surface border border-border bg-surface-sunken p-4 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-text-primary">{request.requesterName}</span>
                    <Badge variant={SCOPE_VARIANT[request.scope]}>
                      {SCOPE_LABEL[request.scope]}
                    </Badge>
                    <span className="text-caption text-text-tertiary">
                      {GRANTEE_ROLE_LABEL[request.requesterRole]} ·{' '}
                      {formatDateTime(request.requestedAt)}
                    </span>
                  </div>
                  {/* The requester's own words. A scope chip says what they
                      asked for; only this says whether they should have it. */}
                  <p className="text-body-sm text-text-secondary">“{request.reason}”</p>
                </div>

                {canManage ? (
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      leadingIcon={X}
                      disabled={busy}
                      onClick={() => onDeny(request)}
                    >
                      Decline
                    </Button>
                    <Button
                      size="sm"
                      leadingIcon={Check}
                      disabled={busy}
                      onClick={() => onApprove(request)}
                    >
                      Approve
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <Panel
        title="Active access"
        description="Everyone who can currently open this record."
        icon={ShieldCheck}
        tone="primary"
        bodyClassName={hasNoActiveAccess(patient) ? undefined : 'p-0'}
      >
        {hasNoActiveAccess(patient) ? (
          <EmptyState
            icon={ShieldX}
            title="No active access grants."
            description="Nobody can open this record. If the patient is still under care, someone needs access before their next appointment."
            tone="warning"
          />
        ) : (
          <div className="px-2 pb-2">
            <DataTable
              bare
              zebra={false}
              density="admin"
              stickyHeader={false}
              headerVoice="overline"
              columns={activeColumns}
              rows={active}
              getRowId={(grant) => grant.id}
              caption={`Active access grants for patient ${patient.id}`}
            />
          </div>
        )}
      </Panel>

      <Panel
        title="Access history"
        description="Grants that have been withdrawn, and why."
        icon={ShieldOff}
        tone="secondary"
        bodyClassName={history.length === 0 ? undefined : 'p-0'}
      >
        {history.length === 0 ? (
          <p className="text-body-sm text-text-secondary">
            No access has been withdrawn from this record.
          </p>
        ) : (
          <div className="px-2 pb-2">
            <DataTable
              bare
              zebra={false}
              density="admin"
              stickyHeader={false}
              headerVoice="overline"
              columns={historyColumns}
              rows={history}
              getRowId={(grant) => grant.id}
              caption={`Withdrawn access grants for patient ${patient.id}`}
            />
          </div>
        )}
      </Panel>

      {!canManage ? (
        <Alert variant="info" title="Read-only">
          Your role can review who holds access but cannot grant or withdraw it.
        </Alert>
      ) : null}
    </div>
  );
}
