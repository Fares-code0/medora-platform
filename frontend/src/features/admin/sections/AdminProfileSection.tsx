import { useState } from 'react';

import {
  CircleCheck,
  FileClock,
  Laptop,
  Link2,
  MonitorSmartphone,
  Phone,
  ShieldCheck,
  Smartphone,
  Tablet,
  Trash2,
  UserRoundCog,
} from 'lucide-react';

import { useToast } from '@/app/providers';
import { CircularProgress } from '@/components/feedback';
import { Grid, PageSections } from '@/components/layout';
import { ProfilePhotoField, TagListField } from '@/components/patterns';
import {
  Badge,
  Button,
  ConfirmationDialog,
  Input,
  Select,
  Switch,
  Textarea,
} from '@/components/ui';
import { useT } from '@/i18n';

import {
  resolveLandingSection,
  selectAdminProfileCompletion,
  useAdminProfile,
  useRemoveDeviceMutation,
  useRevokeSessionMutation,
  useSaveAdminProfileMutation,
  type AdminDevice,
  type AdminProfile,
  type AdminProfileFormValues,
} from '../admin-profile';
import { adminSectionOptions, formatDate } from '../administration.meta';
import { useAdminSettings } from '../api/useAdminSettingsQueries';
import { AsyncSection, Overline, Panel } from '../components/primitives';
import { SectionShell } from '../components/SectionShell';
import { SettingsPanelForm } from '../components/SettingsPanelForm';

/**
 * AdminProfileSection — the administrator's own profile (Phase 18).
 * One validated form panel over the editable document (photo, identity,
 * contact, credentials, links, preferences) beside a live completion rail,
 * with security context (sessions, trusted devices, activity) below.
 * Mirrors the doctor Profile Center in capability while keeping the
 * Administration Center's visual language.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/\S+$/;

const DEVICE_ICON = { desktop: Laptop, mobile: Smartphone, tablet: Tablet } as const;

export function AdminProfileSection() {
  const query = useAdminProfile();

  return (
    <SectionShell slug="profile">
      <AsyncSection
        isLoading={query.isLoading}
        isError={query.isError}
        onRetry={() => void query.refetch()}
      >
        {query.data ? <ProfileBody profile={query.data} /> : null}
      </AsyncSection>
    </SectionShell>
  );
}

function toFormValues(profile: AdminProfile): AdminProfileFormValues {
  return {
    photo: profile.photo,
    fullName: profile.fullName,
    title: profile.title,
    biography: profile.biography,
    contactEmail: profile.contactEmail,
    contactPhone: profile.contactPhone,
    officeLocation: profile.officeLocation,
    emergencyContactName: profile.emergencyContactName,
    emergencyContactPhone: profile.emergencyContactPhone,
    education: [...profile.education],
    certifications: [...profile.certifications],
    experience: [...profile.experience],
    linkedinUrl: profile.linkedinUrl,
    websiteUrl: profile.websiteUrl,
    // Resolved rather than copied: a document written before ADM-01 can still
    // hold a slug that no longer exists, and the select has no option for it.
    landingSection: resolveLandingSection(profile.landingSection),
    weeklyDigest: profile.weeklyDigest,
  };
}

function ProfileBody({ profile }: { profile: AdminProfile }) {
  const { toast } = useToast();
  const save = useSaveAdminProfileMutation();
  const completion = selectAdminProfileCompletion(profile);
  const settings = useAdminSettings();
  const twoFactorRequired = settings.data?.security.twoFactorRequired ?? false;

  const t = useT();
  const sectionOptions = adminSectionOptions(t);

  return (
    <PageSections>
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <SettingsPanelForm
            title="Administrator profile"
            description="Your identity as staff and colleagues see it."
            icon={UserRoundCog}
            value={toFormValues(profile)}
            validate={(draft) => ({
              ...(draft.fullName.trim() ? {} : { fullName: 'Enter your full name' }),
              ...(EMAIL_RE.test(draft.contactEmail) ? {} : { contactEmail: 'Enter a valid email' }),
              ...(draft.contactPhone.trim() ? {} : { contactPhone: 'Enter a phone number' }),
              ...(draft.linkedinUrl === '' || URL_RE.test(draft.linkedinUrl)
                ? {}
                : { linkedinUrl: 'Enter a full URL (https://…)' }),
              ...(draft.websiteUrl === '' || URL_RE.test(draft.websiteUrl)
                ? {}
                : { websiteUrl: 'Enter a full URL (https://…)' }),
            })}
            onSave={(draft) => save.mutateAsync(draft)}
            saving={save.isPending}
          >
            {({ draft, patch, errors }) => (
              <>
                <ProfilePhotoField
                  name={draft.fullName}
                  roleRing="staff"
                  value={draft.photo}
                  onChange={(photo) => patch({ photo })}
                  onError={(message) =>
                    toast({ variant: 'error', title: 'Photo not added', description: message })
                  }
                />

                <Grid columns={{ base: 1, md: 2 }} gap={4}>
                  <Input
                    label="Full name"
                    required
                    value={draft.fullName}
                    onChange={(event) => patch({ fullName: event.target.value })}
                    error={errors.fullName}
                  />
                  <Input
                    label="Job title"
                    value={draft.title}
                    onChange={(event) => patch({ title: event.target.value })}
                  />
                </Grid>

                <Textarea
                  label="Biography"
                  rows={3}
                  maxLength={600}
                  showCount
                  helperText="A short professional summary."
                  value={draft.biography}
                  onChange={(event) => patch({ biography: event.target.value })}
                />

                <div>
                  <Overline>Contact</Overline>
                  <Grid columns={{ base: 1, md: 2 }} gap={4} className="mt-2">
                    <Input
                      label="Email"
                      type="email"
                      required
                      value={draft.contactEmail}
                      onChange={(event) => patch({ contactEmail: event.target.value })}
                      error={errors.contactEmail}
                    />
                    <Input
                      label="Phone"
                      leadingIcon={Phone}
                      required
                      value={draft.contactPhone}
                      onChange={(event) => patch({ contactPhone: event.target.value })}
                      error={errors.contactPhone}
                    />
                    <Input
                      label="Office location"
                      value={draft.officeLocation}
                      onChange={(event) => patch({ officeLocation: event.target.value })}
                    />
                    <Input
                      label="Emergency contact name"
                      value={draft.emergencyContactName}
                      onChange={(event) => patch({ emergencyContactName: event.target.value })}
                    />
                    <Input
                      label="Emergency contact phone"
                      leadingIcon={Phone}
                      value={draft.emergencyContactPhone}
                      onChange={(event) => patch({ emergencyContactPhone: event.target.value })}
                    />
                  </Grid>
                </div>

                <div className="flex flex-col gap-4">
                  <Overline>Credentials & experience</Overline>
                  <TagListField
                    label="Education"
                    placeholder="e.g. BSc Health Informatics — Oregon State, 2016"
                    wide
                    value={draft.education}
                    onChange={(education) => patch({ education })}
                  />
                  <TagListField
                    label="Certificates"
                    placeholder="e.g. Certified Healthcare CIO (CHCIO)"
                    wide
                    value={draft.certifications}
                    onChange={(certifications) => patch({ certifications })}
                  />
                  <TagListField
                    label="Experience"
                    placeholder="e.g. Clinic Operations Manager — 2021–present"
                    wide
                    value={draft.experience}
                    onChange={(experience) => patch({ experience })}
                  />
                </div>

                <div>
                  <Overline>Links</Overline>
                  <Grid columns={{ base: 1, md: 2 }} gap={4} className="mt-2">
                    <Input
                      label="LinkedIn"
                      type="url"
                      placeholder="https://linkedin.com/in/…"
                      leadingIcon={Link2}
                      value={draft.linkedinUrl}
                      onChange={(event) => patch({ linkedinUrl: event.target.value })}
                      error={errors.linkedinUrl}
                    />
                    <Input
                      label="Website"
                      type="url"
                      placeholder="https://…"
                      leadingIcon={Link2}
                      value={draft.websiteUrl}
                      onChange={(event) => patch({ websiteUrl: event.target.value })}
                      error={errors.websiteUrl}
                    />
                  </Grid>
                </div>

                <div className="flex flex-col gap-4">
                  <Overline>Preferences</Overline>
                  <Grid columns={{ base: 1, md: 2 }} gap={4}>
                    <Select
                      label="Landing section"
                      helperText="Where the Administration Center opens."
                      value={draft.landingSection}
                      onChange={(value) =>
                        patch({ landingSection: value as AdminProfile['landingSection'] })
                      }
                      options={sectionOptions}
                    />
                  </Grid>
                  <Switch
                    label="Weekly digest"
                    description="A summary of platform activity every Monday morning."
                    checked={draft.weeklyDigest}
                    onCheckedChange={(weeklyDigest) => patch({ weeklyDigest })}
                  />
                </div>
              </>
            )}
          </SettingsPanelForm>
        </div>

        {/* Right rail: completion + security posture */}
        <div className="flex min-w-0 flex-col gap-4">
          <Panel title="Profile completion" icon={CircleCheck} tone="success">
            <div className="flex items-center gap-4">
              <div className="relative inline-flex shrink-0 items-center justify-center">
                <CircularProgress
                  value={completion.percent}
                  size={48}
                  aria-label={`Profile ${String(completion.percent)}% complete`}
                />
                <span className="absolute text-caption font-bold text-text-primary tabular-nums">
                  {completion.percent}%
                </span>
              </div>
              <div className="min-w-0">
                {completion.missing.length === 0 ? (
                  <p className="text-body-sm text-text-secondary">
                    Your profile is complete — nicely done.
                  </p>
                ) : (
                  <>
                    <p className="text-body-sm font-medium text-text-primary">Still missing</p>
                    <p className="mt-0.5 text-caption text-text-tertiary">
                      {completion.missing.join(' · ')}
                    </p>
                  </>
                )}
              </div>
            </div>
          </Panel>

          <Panel title="Security" icon={ShieldCheck} tone="info">
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-body-sm text-text-secondary">Two-factor authentication</span>
                {twoFactorRequired ? (
                  <Badge variant="success" dot>
                    Enforced
                  </Badge>
                ) : (
                  <Badge variant="warning" dot>
                    Optional
                  </Badge>
                )}
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-body-sm text-text-secondary">Active sessions</span>
                <span className="text-body-sm font-medium text-text-primary tabular-nums">
                  {profile.sessions.length}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-body-sm text-text-secondary">Trusted devices</span>
                <span className="text-body-sm font-medium text-text-primary tabular-nums">
                  {profile.devices.length}
                </span>
              </div>
              <p className="text-caption text-text-secondary">
                The platform-wide policy lives in Settings → Security.
              </p>
            </div>
          </Panel>
        </div>
      </div>

      {/* Sessions · devices · activity */}
      <div className="grid gap-4 lg:grid-cols-3">
        <SessionsPanel profile={profile} />
        <DevicesPanel devices={profile.devices} />
        <Panel
          title="Activity log"
          description="Your recent account actions."
          icon={FileClock}
          tone="accent"
        >
          <ul className="flex flex-col divide-y divide-border">
            {profile.activity.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
              >
                <span className="min-w-0 truncate text-body-sm text-text-primary">
                  {entry.label}
                </span>
                <time className="shrink-0 text-caption text-text-tertiary tabular-nums">
                  {formatDate(entry.at)}
                </time>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </PageSections>
  );
}

function SessionsPanel({ profile }: { profile: AdminProfile }) {
  const { toast } = useToast();
  const revoke = useRevokeSessionMutation();
  const [target, setTarget] = useState<string | null>(null);

  return (
    <Panel
      title="Sessions"
      description="Where you are signed in."
      icon={MonitorSmartphone}
      tone="primary"
    >
      <ul className="flex flex-col divide-y divide-border">
        {profile.sessions.map((session) => (
          <li
            key={session.id}
            className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
          >
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-body-sm font-medium text-text-primary">
                {session.device}
                {session.current ? <Badge variant="success">This device</Badge> : null}
              </p>
              <p className="mt-0.5 text-caption text-text-tertiary">
                {session.location} · {formatDate(session.lastActiveAt)}
              </p>
            </div>
            {!session.current ? (
              <Button variant="ghost" size="sm" onClick={() => setTarget(session.id)}>
                Revoke
              </Button>
            ) : null}
          </li>
        ))}
      </ul>

      <ConfirmationDialog
        open={target !== null}
        onClose={() => setTarget(null)}
        onConfirm={() => {
          if (target !== null) {
            revoke.mutate(target, {
              onSuccess: () => toast({ variant: 'success', title: 'Session revoked' }),
              onError: () => toast({ variant: 'error', title: 'Could not revoke the session' }),
            });
          }
          setTarget(null);
        }}
        title="Revoke this session?"
        description="The device is signed out immediately and must sign in again."
        confirmLabel="Revoke session"
      />
    </Panel>
  );
}

function DevicesPanel({ devices }: { devices: readonly AdminDevice[] }) {
  const { toast } = useToast();
  const remove = useRemoveDeviceMutation();
  const [target, setTarget] = useState<AdminDevice | null>(null);

  return (
    <Panel
      title="Trusted devices"
      description="Devices that skip extra verification."
      icon={Laptop}
      tone="warning"
    >
      {devices.length === 0 ? (
        <p className="text-body-sm text-text-tertiary">No trusted devices.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {devices.map((device) => {
            const Icon = DEVICE_ICON[device.kind];
            return (
              <li
                key={device.id}
                className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Icon
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0 text-text-tertiary"
                    strokeWidth={1.75}
                  />
                  <div className="min-w-0">
                    <p className="truncate text-body-sm font-medium text-text-primary">
                      {device.name}
                    </p>
                    <p className="text-caption text-text-tertiary">
                      trusted since {formatDate(device.trustedSince)}
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  leadingIcon={Trash2}
                  aria-label={`Remove ${device.name}`}
                  onClick={() => setTarget(device)}
                >
                  Remove
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmationDialog
        open={target !== null}
        onClose={() => setTarget(null)}
        onConfirm={() => {
          if (target !== null) {
            remove.mutate(target.id, {
              onSuccess: () => toast({ variant: 'success', title: 'Device removed' }),
              onError: () => toast({ variant: 'error', title: 'Could not remove the device' }),
            });
          }
          setTarget(null);
        }}
        title={`Remove ${target?.name ?? 'this device'}?`}
        description="The device loses trusted status and must verify again at next sign-in."
        confirmLabel="Remove device"
      />
    </Panel>
  );
}
