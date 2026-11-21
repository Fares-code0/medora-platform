import { useState } from 'react';

import { ArrowLeft, Ban, BadgeCheck, FileWarning, KeyRound, UserRoundCheck, X } from 'lucide-react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { useAuth, useToast } from '@/app/providers';
import { ErrorState, Skeleton } from '@/components/feedback';
import { PAGE_TITLE_CLASS, PageContainer, PageSections } from '@/components/layout';
import { StatusBadge } from '@/components/patterns';
import {Avatar, Button, ConfirmationDialog, Tabs} from '@/components/ui';
import { routes } from '@/routes';

import { AsyncSection } from '../components/primitives';
import { adminRefusal, loadFailureDescription } from '../refusal';

import {
  doctorsCapabilities,
  useDoctorDetail,
  useDoctorsMutations,
} from './api/useDoctorsQueries';
import { DoctorDocumentsTab } from './DoctorDocumentsTab';
import {
  ACCOUNT_LABEL,
  ACCOUNT_KIND,
  canReactivate,
  canSuspend,
  DOCUMENT_LABEL,
  formatDate,
  formatSince,
  initialRequestKinds,
  licenceExpiry,
  VERIFICATION_LABEL,
  VERIFICATION_KIND,
} from './doctors';
import type {
  AdministrativeFields,
  CredentialDocument,
  DoctorRecord,
  RequestableDocumentKind,
} from './doctors.types';
import {
  DoctorActivityTab,
  DoctorAppointmentsTab,
  DoctorProfileTab,
  DoctorStatisticsTab,
} from './DoctorTabs';
import { DocumentKindPicker } from './DocumentKindPicker';
import { ReasonDialog } from './ReasonDialog';
import { SuspensionImpact } from './SuspensionImpact';

/**
 * Doctor profile, admin view (ADM-03 · UX §3.3) — the complete
 * administrative file on one doctor.
 *
 * The identity header is required context, so a failure there fails the
 * page rather than rendering tabs about nobody. The tab lives in the URL
 * (`?tab=documents`) so the verification queue can link straight to the
 * evidence, and so an administrator can send a colleague the exact view
 * they are looking at.
 */

type ProfileTab = 'profile' | 'documents' | 'activity' | 'appointments' | 'statistics';

const TABS: readonly { value: ProfileTab; label: string }[] = [
  { value: 'profile', label: 'Profile' },
  { value: 'documents', label: 'Documents' },
  { value: 'activity', label: 'Activity' },
  { value: 'appointments', label: 'Appointments' },
  { value: 'statistics', label: 'Statistics' },
];

function isProfileTab(value: string | null): value is ProfileTab {
  return TABS.some((tab) => tab.value === value);
}

/**
 * The tabs this record can fill. Activity and Statistics read history the
 * live API does not serve (FE-10.10), so a live profile drops them rather
 * than drawing empty charts that would read as "this doctor did nothing".
 */
function tabsFor(doctor: DoctorRecord): readonly { value: ProfileTab; label: string }[] {
  return TABS.filter((tab) => {
    if (tab.value === 'activity') return doctor.activity !== null;
    if (tab.value === 'statistics') return doctor.statistics !== null;
    return true;
  });
}

function DoctorProfilePageContent() {
  const { doctorId = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();

  const detail = useDoctorDetail(doctorId);
  const mutations = useDoctorsMutations();

  const requested = searchParams.get('tab');

  const [rejectingDocument, setRejectingDocument] = useState<CredentialDocument | null>(null);
  const [requestingDocs, setRequestingDocs] = useState(false);
  const [requestKinds, setRequestKinds] = useState<readonly RequestableDocumentKind[]>([]);
  const [rejectingApplication, setRejectingApplication] = useState(false);
  const [suspending, setSuspending] = useState(false);
  const [reactivating, setReactivating] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const actor = user?.name ?? 'Administrator';
  const doctor = detail.data ?? undefined;

  const setTab = (next: string) => {
    const params = new URLSearchParams(searchParams);
    params.set('tab', next);
    setSearchParams(params, { replace: true });
  };

  const failureMessage = adminRefusal;

  const fail = (title: string) => (error: unknown) => {
    const message = failureMessage(error);
    setActionError(message);
    toast({ variant: 'error', title, description: message });
  };

  const succeed = (title: string, description?: string) => () => {
    setActionError(null);
    setRejectingDocument(null);
    setRequestingDocs(false);
    setRejectingApplication(false);
    setSuspending(false);
    setReactivating(false);
    setResetting(false);
    toast({ variant: 'success', title, ...(description === undefined ? {} : { description }) });
  };

  if (detail.isLoading) return <ProfileSkeleton />;
  if (detail.isError) {
    const description = loadFailureDescription(detail.error);
    return (
      <ErrorState
        headingLevel="h1"
        error={detail.error}
        onRetry={() => void detail.refetch()}
        {...(description === undefined ? {} : { description })}
      />
    );
  }

  if (doctor === undefined) {
    return (
      <div className="flex flex-col items-center gap-4">
        <ErrorState
          title="No such doctor"
          headingLevel="h1"
          description="This profile does not exist, or the doctor has been removed from the platform."
          className="w-full"
        />
        <Button
          variant="secondary"
          leadingIcon={ArrowLeft}
          onClick={() => void navigate(routes.admin.doctors)}
        >
          Back to doctors
        </Button>
      </div>
    );
  }

  const tabs = tabsFor(doctor);
  const tab: ProfileTab =
    isProfileTab(requested) && tabs.some((entry) => entry.value === requested)
      ? requested
      : 'profile';

  // Ticking a check is deliberately absent: it is a per-field write that
  // must not lock the other two boxes while it is in flight.
  const busy =
    mutations.approveDocument.isPending ||
    mutations.rejectDocument.isPending ||
    mutations.completeVerification.isPending;

  return (
    <PageSections>
      <IdentityHeader
        doctor={doctor}
        onBack={() => void navigate(routes.admin.doctors)}
        actions={
          <>
            {doctor.verification !== 'verified' && doctor.verification !== 'rejected' ? (
              <>
                <Button
                  variant="secondary"
                  leadingIcon={FileWarning}
                  onClick={() => {
                    setActionError(null);
                    setRequestKinds(initialRequestKinds(doctor));
                    setRequestingDocs(true);
                  }}
                >
                  Request documents
                </Button>
                <Button
                  variant="secondary"
                  leadingIcon={X}
                  onClick={() => {
                    setActionError(null);
                    setRejectingApplication(true);
                  }}
                >
                  Reject application
                </Button>
              </>
            ) : null}
            {doctor.verification === 'rejected' && doctorsCapabilities.returnToReview ? (
              <Button
                variant="secondary"
                leadingIcon={BadgeCheck}
                loading={mutations.returnToReview.isPending}
                onClick={() => {
                  mutations.returnToReview.mutate(
                    { doctorId: doctor.id, actor },
                    {
                      onSuccess: succeed(
                        'Returned to review',
                        'The application is back in the pending queue.',
                      ),
                      onError: fail('Nothing was changed'),
                    },
                  );
                }}
              >
                Return to review
              </Button>
            ) : null}
            {doctorsCapabilities.resetAccess ? (
              <Button
                variant="secondary"
                leadingIcon={KeyRound}
                onClick={() => setResetting(true)}
              >
                Reset access
              </Button>
            ) : null}
            {canReactivate(doctor) ? (
              <Button leadingIcon={UserRoundCheck} onClick={() => setReactivating(true)}>
                Reactivate
              </Button>
            ) : null}
            {canSuspend(doctor) ? (
              <Button
                variant="destructive"
                leadingIcon={Ban}
                onClick={() => {
                  setActionError(null);
                  setSuspending(true);
                }}
              >
                Suspend
              </Button>
            ) : null}
          </>
        }
      />

      <Tabs
        aria-label="Doctor profile sections"
        value={tab}
        onValueChange={setTab}
        items={tabs.map((entry) => ({ value: entry.value, label: entry.label }))}
      />

      <AsyncSection isLoading={false} isError={false}>
        {tab === 'profile' ? (
          <DoctorProfileTab
            doctor={doctor}
            busy={mutations.updateAdministrative.isPending}
            onSaveAdministrative={(fields: AdministrativeFields) => {
              mutations.updateAdministrative.mutate(
                { doctorId: doctor.id, actor, fields },
                {
                  onSuccess: succeed(
                    'Administrative fields updated',
                    'The change is recorded against your account.',
                  ),
                  onError: fail('Nothing was changed'),
                },
              );
            }}
          />
        ) : null}

        {tab === 'documents' ? (
          <DoctorDocumentsTab
            doctor={doctor}
            busy={busy}
            onCheck={(documentId, field, value) => {
              mutations.setCheck.mutate({ doctorId: doctor.id, documentId, field, value });
            }}
            onApprove={(documentId) => {
              mutations.approveDocument.mutate(
                { doctorId: doctor.id, documentId, actor },
                {
                  onSuccess: succeed('Document approved'),
                  onError: fail('The document was not approved'),
                },
              );
            }}
            onReject={(target) => {
              setActionError(null);
              setRejectingDocument(target);
            }}
            onComplete={() => {
              mutations.completeVerification.mutate(
                { doctorId: doctor.id, actor },
                {
                  onSuccess: succeed(
                    `${doctor.name} is verified`,
                    'They can now be assigned patients on the platform.',
                  ),
                  onError: fail('Verification was not completed'),
                },
              );
            }}
          />
        ) : null}

        {tab === 'activity' ? <DoctorActivityTab doctor={doctor} /> : null}
        {tab === 'appointments' ? <DoctorAppointmentsTab doctor={doctor} /> : null}
        {tab === 'statistics' ? <DoctorStatisticsTab doctor={doctor} /> : null}
      </AsyncSection>

      {/* ── Decisions ──────────────────────────────────────────── */}

      <ReasonDialog
        open={rejectingDocument !== null}
        title={`Reject ${rejectingDocument === null ? 'this document' : (rejectingDocument.filename ?? DOCUMENT_LABEL[rejectingDocument.kind])}?`}
        description="The doctor is told what was wrong and can upload a replacement."
        confirmLabel="Reject document"
        confirmIcon={X}
        tone="destructive"
        placeholder="e.g. The scan is cropped; page two of the certificate is missing."
        submitting={mutations.rejectDocument.isPending}
        error={actionError}
        onClose={() => {
          setRejectingDocument(null);
          setActionError(null);
        }}
        onConfirm={(reason) => {
          const target = rejectingDocument;
          if (target === null) return;
          mutations.rejectDocument.mutate(
            { doctorId: doctor.id, documentId: target.id, actor, reason },
            { onSuccess: succeed('Document rejected'), onError: fail('Nothing was changed') },
          );
        }}
      />

      <ReasonDialog
        open={requestingDocs}
        title={`Request more documents from ${doctor.name}?`}
        description="They stay in the queue as “Docs requested” until the files arrive."
        confirmLabel="Send request"
        confirmIcon={FileWarning}
        placeholder="e.g. A clear scan of both pages of the degree certificate."
        consequence={<DocumentKindPicker value={requestKinds} onChange={setRequestKinds} />}
        submitting={mutations.requestDocuments.isPending}
        error={actionError}
        onClose={() => {
          setRequestingDocs(false);
          setActionError(null);
        }}
        onConfirm={(reason) => {
          if (requestKinds.length === 0) {
            setActionError('Choose at least one document to request.');
            return;
          }
          mutations.requestDocuments.mutate(
            { doctorId: doctor.id, actor, reason, kinds: requestKinds },
            { onSuccess: succeed('Request sent'), onError: fail('Nothing was sent') },
          );
        }}
      />

      <ReasonDialog
        open={rejectingApplication}
        title={`Reject ${doctor.name}’s application?`}
        description="The account is suspended and the reason is sent to them."
        confirmLabel="Reject application"
        confirmIcon={Ban}
        tone="destructive"
        placeholder="e.g. The licence number does not match the national register."
        submitting={mutations.rejectApplication.isPending}
        error={actionError}
        onClose={() => {
          setRejectingApplication(false);
          setActionError(null);
        }}
        onConfirm={(reason) => {
          mutations.rejectApplication.mutate(
            { doctorId: doctor.id, actor, reason },
            { onSuccess: succeed('Application rejected'), onError: fail('Nothing was changed') },
          );
        }}
      />

      <ReasonDialog
        open={suspending}
        title={`Suspend ${doctor.name}?`}
        description="They lose access immediately. Their patients and records are untouched."
        confirmLabel="Suspend account"
        confirmIcon={Ban}
        tone="destructive"
        placeholder="e.g. Prescribing audit opened following a pharmacy report."
        consequence={<SuspensionImpact doctorId={doctor.id} doctorName={doctor.name} />}
        submitting={mutations.suspend.isPending}
        error={actionError}
        onClose={() => {
          setSuspending(false);
          setActionError(null);
        }}
        onConfirm={(reason) => {
          mutations.suspend.mutate(
            { doctorId: doctor.id, actor, reason },
            {
              onSuccess: succeed(
                `${doctor.name} suspended`,
                'Their upcoming appointments still need reassigning.',
              ),
              onError: fail('Nothing was changed'),
            },
          );
        }}
      />

      <ConfirmationDialog
        open={reactivating}
        onClose={() => setReactivating(false)}
        onConfirm={() => {
          mutations.reactivate.mutate(
            { doctorId: doctor.id, actor },
            {
              onSuccess: succeed(`${doctor.name} reactivated`),
              onError: fail('Reactivation failed'),
            },
          );
        }}
        title={`Reactivate ${doctor.name}?`}
        description="They regain access straight away. The suspension stays on their record."
        confirmLabel="Reactivate"
        tone="primary"
        loading={mutations.reactivate.isPending}
      />

      <ConfirmationDialog
        open={resetting}
        onClose={() => setResetting(false)}
        onConfirm={() => {
          mutations.resetAccess.mutate(
            { doctorId: doctor.id, actor },
            { onSuccess: succeed('Reset link sent'), onError: fail('Nothing was sent') },
          );
        }}
        title={`Send an access reset to ${doctor.name}?`}
        description={`A reset link goes to ${doctor.email}. You are not setting a password — only they can do that.`}
        confirmLabel="Send reset link"
        tone="primary"
        loading={mutations.resetAccess.isPending}
      />
    </PageSections>
  );
}

/**
 * Identity is required context (§3.3), so it renders as its own band above
 * the tabs rather than as one panel among them.
 */
function IdentityHeader({
  doctor,
  actions,
  onBack,
}: {
  doctor: DoctorRecord;
  actions: React.ReactNode;
  onBack: () => void;
}) {
  const licenceExpiresAt = licenceExpiry(doctor);
  const now = Date.now();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button variant="ghost" size="sm" leadingIcon={ArrowLeft} onClick={onBack}>
          All doctors
        </Button>
      </div>

      <div className="flex flex-col gap-4 rounded-surface border border-border bg-surface p-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-4">
          <Avatar name={doctor.name} size="lg" roleRing="doctor" decorative />
          <div className="min-w-0">
            <h1 className={PAGE_TITLE_CLASS}>{doctor.name}</h1>
            <p className="text-body-sm text-text-secondary">
              {doctor.title.length > 0 ? `${doctor.title} · ${doctor.specialty}` : doctor.specialty}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusBadge
                status={VERIFICATION_KIND[doctor.verification]}
                label={VERIFICATION_LABEL[doctor.verification]}
              />
              <StatusBadge
                status={ACCOUNT_KIND[doctor.account]}
                label={ACCOUNT_LABEL[doctor.account]}
              />
            </div>
            <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-caption text-text-tertiary">
              <div className="flex gap-1.5">
                <dt>Joined</dt>
                <dd className="text-text-secondary">{formatDate(doctor.joinedAt)}</dd>
              </div>
              <div className="flex gap-1.5">
                <dt>Licence expires</dt>
                <dd className="text-text-secondary">
                  {licenceExpiresAt === null ? '—' : formatDate(licenceExpiresAt)}
                </dd>
              </div>
              <div className="flex gap-1.5">
                <dt>Last active</dt>
                <dd className="text-text-secondary">{formatSince(doctor.lastActiveAt, now)}</dd>
              </div>
            </dl>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      </div>

      {doctor.account === 'suspended' && doctor.suspensionReason !== null ? (
        <p className="rounded-surface bg-error-subtle px-4 py-2.5 text-body-sm text-error">
          Suspended — {doctor.suspensionReason}
        </p>
      ) : null}
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-8 w-32 rounded-surface" />
      <Skeleton className="h-32 w-full rounded-surface" />
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
export function DoctorProfilePage() {
  return (
    <PageContainer width="2xl">
      <DoctorProfilePageContent />
    </PageContainer>
  );
}
