import { useState } from 'react';

import { ArrowLeft, Ban, KeyRound, LockOpen, UserRoundCheck } from 'lucide-react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { useAuth, useCan, useToast } from '@/app/providers';
import { ErrorState, Skeleton } from '@/components/feedback';
import { PAGE_TITLE_CLASS, PageContainer, PageSections } from '@/components/layout';
import { StatusBadge } from '@/components/patterns';
import {Button, ConfirmationDialog, Tabs} from '@/components/ui';
import { routes } from '@/routes';
import { cn } from '@/utils/cn';

import { MaskedIdentifier } from '../phi';

import { AccessGrid } from './AccessGrid';
import { PatientsError } from './api/patients.api';
import { usePatientsDocument, usePatientsMutations } from './api/usePatientsQueries';
import { PatientReasonDialog } from './PatientReasonDialog';
import {
  canDeactivate,
  canReactivate,
  canResetCredentials,
  canUnlock,
  formatDate,
  formatSince,
  SCOPE_LABEL,
  STATUS_LABEL,
  STATUS_KIND,
} from './patients';
import type { AccessGrant, AccessRequest, PatientAccount } from './patients.types';
import { PatientActivityTab, PatientProfileTab } from './PatientTabs';

/**
 * Patient account, admin view (ADM-04 · UX §3.4) — the administrative file
 * on one patient account, in three tabs: who they are for support purposes,
 * what the account has done, and who can reach the record.
 *
 * The tab lives in the URL (`?tab=permissions`) so an access review can be
 * linked to directly and so an administrator can hand a colleague the exact
 * view they are looking at — the same convention as the doctor profile.
 *
 * The identity header masks like everything else. It shows the patient id
 * in the clear because that is the account's handle, not the person's name.
 */

type ProfileTab = 'profile' | 'activity' | 'permissions';

const TABS: readonly { value: ProfileTab; label: string }[] = [
  { value: 'profile', label: 'Profile' },
  { value: 'activity', label: 'Activity' },
  { value: 'permissions', label: 'Permissions' },
];

function isProfileTab(value: string | null): value is ProfileTab {
  return TABS.some((tab) => tab.value === value);
}

function PatientProfilePageContent() {
  const { patientId = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const can = useCan();
  const { toast } = useToast();

  const document = usePatientsDocument();
  const mutations = usePatientsMutations();

  const requested = searchParams.get('tab');
  const tab: ProfileTab = isProfileTab(requested) ? requested : 'profile';

  const [unlocking, setUnlocking] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [reactivating, setReactivating] = useState(false);
  const [revoking, setRevoking] = useState<AccessGrant | null>(null);
  const [denying, setDenying] = useState<AccessRequest | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const actor = user?.name ?? 'Administrator';
  const canManage = can('patients.manageAccounts');
  const patient = document.data?.patients.find((entry) => entry.id === patientId);

  const setTab = (next: string) => {
    const params = new URLSearchParams(searchParams);
    params.set('tab', next);
    setSearchParams(params, { replace: true });
  };

  const failureMessage = (error: unknown): string =>
    error instanceof PatientsError
      ? error.message
      : 'The platform did not accept that change. Nothing was altered.';

  const closeAll = () => {
    setUnlocking(false);
    setResetting(false);
    setDeactivating(false);
    setReactivating(false);
    setRevoking(null);
    setDenying(null);
  };

  const succeed = (title: string, description?: string) => () => {
    setActionError(null);
    closeAll();
    toast({ variant: 'success', title, ...(description === undefined ? {} : { description }) });
  };

  /** Dialog-borne failures stay in the dialog; the rest become toasts. */
  const failInDialog = (error: unknown) => setActionError(failureMessage(error));

  const failWithToast = (title: string) => (error: unknown) => {
    closeAll();
    toast({ variant: 'error', title, description: failureMessage(error) });
  };

  if (document.isLoading) return <ProfileSkeleton />;
  if (document.isError) return <ErrorState headingLevel="h1" onRetry={() => void document.refetch()} />;

  if (patient === undefined) {
    return (
      <div className="flex flex-col items-center gap-4">
        <ErrorState
          title="No such account"
          headingLevel="h1"
          description="This patient account does not exist, or it has been removed from the platform."
          className="w-full"
        />
        <Button
          variant="secondary"
          leadingIcon={ArrowLeft}
          onClick={() => void navigate(routes.admin.patients)}
        >
          Back to patients
        </Button>
      </div>
    );
  }

  const busy =
    mutations.revokeAccess.isPending ||
    mutations.approveRequest.isPending ||
    mutations.denyRequest.isPending;

  const pendingCount = patient.accessRequests.length;

  return (
    <PageSections>
      <IdentityHeader
        patient={patient}
        onBack={() => void navigate(routes.admin.patients)}
        actions={
          canManage ? (
            <>
              {canUnlock(patient) ? (
                <Button
                  variant="secondary"
                  leadingIcon={LockOpen}
                  onClick={() => setUnlocking(true)}
                >
                  Unlock
                </Button>
              ) : null}
              {canResetCredentials(patient) ? (
                <Button
                  variant="secondary"
                  leadingIcon={KeyRound}
                  onClick={() => setResetting(true)}
                >
                  Reset credentials
                </Button>
              ) : null}
              {canReactivate(patient) ? (
                <Button leadingIcon={UserRoundCheck} onClick={() => setReactivating(true)}>
                  Reactivate
                </Button>
              ) : null}
              {canDeactivate(patient) ? (
                <Button
                  variant="secondary"
                  leadingIcon={Ban}
                  onClick={() => {
                    setActionError(null);
                    setDeactivating(true);
                  }}
                >
                  Deactivate
                </Button>
              ) : null}
            </>
          ) : null
        }
      />

      <Tabs
        aria-label="Patient account"
        value={tab}
        onValueChange={setTab}
        items={TABS.map((entry) => ({
          value: entry.value,
          label: entry.label,
          // Only the tab with work on it carries a count.
          ...(entry.value === 'permissions' && pendingCount > 0 ? { count: pendingCount } : {}),
        }))}
      />

      {tab === 'profile' ? <PatientProfileTab patient={patient} /> : null}
      {tab === 'activity' ? <PatientActivityTab patient={patient} /> : null}
      {tab === 'permissions' ? (
        <AccessGrid
          patient={patient}
          canManage={canManage}
          busy={busy}
          onApprove={(request) => {
            mutations.approveRequest.mutate(
              { patientId: patient.id, requestId: request.id, actor },
              {
                onSuccess: succeed(
                  'Access granted',
                  `${request.requesterName} can now open ${SCOPE_LABEL[request.scope].toLowerCase()}.`,
                ),
                onError: failWithToast('Access was not granted'),
              },
            );
          }}
          onDeny={(request) => {
            setActionError(null);
            setDenying(request);
          }}
          onRevoke={(grant) => {
            setActionError(null);
            setRevoking(grant);
          }}
        />
      ) : null}

      <ConfirmationDialog
        open={unlocking}
        onClose={() => setUnlocking(false)}
        onConfirm={() => {
          mutations.unlock.mutate(
            { patientId: patient.id, actor },
            {
              onSuccess: succeed('Account unlocked', 'They can sign in again.'),
              onError: failWithToast('Still locked'),
            },
          );
        }}
        title={`Unlock ${patient.id}?`}
        description="Unlocking lets them sign in with their existing password."
        confirmLabel="Unlock account"
        tone="primary"
        loading={mutations.unlock.isPending}
      />

      <ConfirmationDialog
        open={resetting}
        onClose={() => setResetting(false)}
        onConfirm={() => {
          mutations.resetCredentials.mutate(
            { patientId: patient.id, actor },
            {
              onSuccess: succeed(
                'Reset link sent',
                'Only the patient can choose the new password.',
              ),
              onError: failWithToast('Nothing was sent'),
            },
          );
        }}
        title={`Send a credential reset to ${patient.id}?`}
        description="A secure link goes to the address on the account. You are not setting a password — only the patient can do that."
        confirmLabel="Send reset link"
        tone="primary"
        loading={mutations.resetCredentials.isPending}
      />

      <ConfirmationDialog
        open={reactivating}
        onClose={() => setReactivating(false)}
        onConfirm={() => {
          mutations.reactivate.mutate(
            { patientId: patient.id, actor },
            {
              onSuccess: succeed('Account reactivated'),
              onError: failWithToast('Reactivation failed'),
            },
          );
        }}
        title={`Reactivate ${patient.id}?`}
        description="They can sign in again. The deactivation stays in the account history."
        confirmLabel="Reactivate"
        tone="primary"
        loading={mutations.reactivate.isPending}
      />

      <PatientReasonDialog
        open={deactivating}
        title={`Deactivate ${patient.id}?`}
        description="They lose portal access immediately. Their medical record is untouched and their doctors keep their access."
        confirmLabel="Deactivate account"
        confirmIcon={Ban}
        tone="destructive"
        placeholder="e.g. Closure requested by the patient in ticket SUP-4471."
        submitting={mutations.deactivate.isPending}
        error={actionError}
        onClose={() => {
          setDeactivating(false);
          setActionError(null);
        }}
        onConfirm={(reason) => {
          mutations.deactivate.mutate(
            { patientId: patient.id, actor, reason },
            {
              onSuccess: succeed('Account deactivated'),
              onError: failInDialog,
            },
          );
        }}
      />

      <PatientReasonDialog
        open={revoking !== null}
        title={`Revoke ${revoking?.granteeName ?? 'this'}’s access?`}
        description={
          revoking === null
            ? ''
            : `They lose ${SCOPE_LABEL[revoking.scope].toLowerCase()} access to this record immediately. The grant stays in the access history.`
        }
        confirmLabel="Revoke access"
        confirmIcon={Ban}
        tone="destructive"
        placeholder="e.g. Transferred to another clinic; access no longer clinically required."
        submitting={mutations.revokeAccess.isPending}
        error={actionError}
        onClose={() => {
          setRevoking(null);
          setActionError(null);
        }}
        onConfirm={(reason) => {
          if (revoking === null) return;
          mutations.revokeAccess.mutate(
            { patientId: patient.id, grantId: revoking.id, actor, reason },
            {
              onSuccess: succeed('Access revoked', 'The grant is now in the access history.'),
              onError: failInDialog,
            },
          );
        }}
      />

      <PatientReasonDialog
        open={denying !== null}
        title={`Decline ${denying?.requesterName ?? 'this'}’s request?`}
        description="They are told the request was declined. They can ask again with more context."
        confirmLabel="Decline request"
        tone="primary"
        placeholder="e.g. Not treating this patient; ask the responsible consultant to request it."
        helperText="Sent to the requester and kept on the account record."
        submitting={mutations.denyRequest.isPending}
        error={actionError}
        onClose={() => {
          setDenying(null);
          setActionError(null);
        }}
        onConfirm={(reason) => {
          if (denying === null) return;
          mutations.denyRequest.mutate(
            { patientId: patient.id, requestId: denying.id, actor, reason },
            {
              onSuccess: succeed('Request declined'),
              onError: failInDialog,
            },
          );
        }}
      />
    </PageSections>
  );
}

/* ── Identity header ──────────────────────────────────────────── */

function IdentityHeader({
  patient,
  onBack,
  actions,
}: {
  patient: PatientAccount;
  onBack: () => void;
  actions: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button variant="ghost" size="sm" leadingIcon={ArrowLeft} onClick={onBack}>
          Back to patients
        </Button>
      </div>

      <div className="flex flex-col gap-4 rounded-surface border border-border bg-surface p-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className={cn('flex flex-wrap items-center gap-2', PAGE_TITLE_CLASS)}>
            <MaskedIdentifier
              subjectId={patient.id}
              subjectLabel={`Patient ${patient.id}`}
              kind="name"
              value={patient.name}
            />
            <StatusBadge status={STATUS_KIND[patient.status]} label={STATUS_LABEL[patient.status]} />
          </h1>
          <p className="text-body-sm text-text-secondary">
            {patient.id} · registered {formatDate(patient.registeredAt)} · last active{''}
            {formatSince(patient.lastActivityAt, Date.now())}
          </p>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      <Skeleton className="h-8 w-40 rounded-surface" />
      <Skeleton className="h-28 w-full rounded-surface" />
      <Skeleton className="h-10 w-full rounded-surface" />
      <Skeleton className="h-64 w-full rounded-surface" />
    </div>
  );
}

/**
 * The page frame the admin area's SectionShell gives every other screen.
 * This page draws its own identity header instead of a SECTION_META one, so
 * it never picked up the container and rendered flush to the viewport edges
 * with no max width. Wrapping the whole component rather than each `return`
 * frames the loading, error and not-found branches too.
 */
export function PatientProfilePage() {
  return (
    <PageContainer width="2xl">
      <PatientProfilePageContent />
    </PageContainer>
  );
}
