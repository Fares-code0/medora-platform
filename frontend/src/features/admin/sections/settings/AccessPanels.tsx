import { useState } from 'react';

import { Copy, KeyRound, Plus, ShieldOff, UserPlus } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';

import { useAuth, useToast } from '@/app/providers';
import { Grid } from '@/components/layout';
import {
  Avatar,
  Badge,
  Button,
  ConfirmationDialog,
  Input,
  Modal,
  SearchInput,
  Select,
  Switch,
} from '@/components/ui';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { formatDateWith } from '@/i18n';
import { isApiError } from '@/types/api';
import { copyText } from '@/utils/clipboard';

import type { AccessUser, InvitableRole } from '../../access/access-service';
import { InviteStaffDialog } from '../../access/InviteStaffDialog';
import {
  useAccessRoles,
  useAccessUsers,
  useInviteStaffMutation,
  useUpdateAccessUserMutation,
} from '../../access/useAccessQueries';
import {
  PLATFORM_ROLES,
  PLATFORM_ROLE_LABEL,
  SETTINGS_PANELS,
  type AdminSettingsDocument,
  type PlatformRole,
} from '../../admin-settings.types';
import { formatDate } from '../../administration.meta';
import type { AuditEvent } from '../../administration.types';
import { useAuditEvents } from '../../api/useAdministrationQueries';
import {
  useCreateApiKeyMutation,
  useResetSectionMutation,
  useRevokeApiKeyMutation,
  useSaveSectionMutation,
} from '../../api/useAdminSettingsQueries';
import { AsyncSection, GridEmpty, Panel } from '../../components/primitives';
import { SettingsPanelForm } from '../../components/SettingsPanelForm';
import { adminRefusal } from '../../refusal';

/**
 * Access-group settings panels (Phase 18): Security policy, Users &
 * Permissions, API Keys, Audit Logs. Collection panels mutate the settings
 * document directly; the audit log is the platform's read-only event feed.
 */

function meta(id: string) {
  const found = SETTINGS_PANELS.find((panel) => panel.id === id);
  if (!found) throw new Error(`Unknown settings panel: ${id}`);
  return found;
}

function formatDateTime(iso: string): string {
  return formatDateWith(new Date(iso), {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/* ── Security policy ──────────────────────────────────────────── */

export function SecurityPanel({ document }: { document: AdminSettingsDocument }) {
  const save = useSaveSectionMutation('security');
  const reset = useResetSectionMutation('security');
  const info = meta('security');

  const range = (value: number, min: number, max: number, message: string) =>
    value >= min && value <= max ? undefined : message;

  return (
    <SettingsPanelForm
      title={info.label}
      description={info.description}
      icon={info.icon}
      value={document.security}
      validate={(draft) => {
        const errors: Record<string, string> = {};
        const expiry = range(draft.passwordExpiryDays, 30, 365, 'Between 30 and 365 days');
        const timeout = range(draft.sessionTimeoutMinutes, 5, 240, 'Between 5 and 240 minutes');
        const attempts = range(draft.loginAttemptLimit, 3, 10, 'Between 3 and 10 attempts');
        if (expiry) errors['passwordExpiryDays'] = expiry;
        if (timeout) errors['sessionTimeoutMinutes'] = timeout;
        if (attempts) errors['loginAttemptLimit'] = attempts;
        return errors;
      }}
      onSave={(draft) => save.mutateAsync(draft)}
      onResetDefaults={() => reset.mutateAsync()}
      saving={save.isPending}
      resetting={reset.isPending}
    >
      {({ draft, patch, errors }) => (
        <>
          <Switch
            label="Require two-factor authentication"
            description="Every account must enroll a second factor at next sign-in."
            checked={draft.twoFactorRequired}
            onCheckedChange={(checked) => patch({ twoFactorRequired: checked })}
          />
          <Grid columns={{ base: 1, md: 3 }} gap={4}>
            <Input
              label="Password expiry (days)"
              type="number"
              min={30}
              max={365}
              value={String(draft.passwordExpiryDays)}
              onChange={(event) => patch({ passwordExpiryDays: Number(event.target.value) })}
              error={errors.passwordExpiryDays}
            />
            <Input
              label="Session timeout (minutes)"
              type="number"
              min={5}
              max={240}
              value={String(draft.sessionTimeoutMinutes)}
              onChange={(event) => patch({ sessionTimeoutMinutes: Number(event.target.value) })}
              error={errors.sessionTimeoutMinutes}
            />
            <Input
              label="Login attempt limit"
              type="number"
              min={3}
              max={10}
              value={String(draft.loginAttemptLimit)}
              onChange={(event) => patch({ loginAttemptLimit: Number(event.target.value) })}
              error={errors.loginAttemptLimit}
            />
          </Grid>
          <Switch
            label="Single session per user"
            description="Signing in on a new device signs out the previous one."
            checked={draft.singleSessionPerUser}
            onCheckedChange={(checked) => patch({ singleSessionPerUser: checked })}
          />
        </>
      )}
    </SettingsPanelForm>
  );
}

/* ── Users & permissions ──────────────────────────────────────── */

/** Role codes outside the matrix's five, as the live user list carries them. */
const OTHER_ROLE_LABEL: Readonly<Record<string, string>> = { patient: 'Patient' };

function roleLabel(code: string): string {
  if ((PLATFORM_ROLES as readonly string[]).includes(code)) {
    return PLATFORM_ROLE_LABEL[code as PlatformRole];
  }
  return OTHER_ROLE_LABEL[code] ?? code.charAt(0).toUpperCase() + code.slice(1);
}

const ROLE_FILTER_OPTIONS = [
  { value: 'all', label: 'All roles' },
  ...PLATFORM_ROLES.map((role) => ({ value: role, label: PLATFORM_ROLE_LABEL[role] })),
  { value: 'patient', label: OTHER_ROLE_LABEL['patient'] ?? 'Patient' },
];

/**
 * The role filter lives in `?role=`, like every other list filter, because
 * the permission matrix links each role here — this panel filtered to one
 * role is UX §3.9's per-role member list. A value the filter does not offer
 * reads as "all", never as a filter nobody can see or clear.
 */
function roleFilterFrom(params: URLSearchParams): string {
  const value = params.get('role');
  return ROLE_FILTER_OPTIONS.some((option) => option.value === value) ? (value ?? 'all') : 'all';
}

/**
 * Why a change to an account was refused. The administrator role is the one
 * refusal worth its own sentence: the server will not confer it here at all
 * (an administrator needs an enrolled second factor, which only the
 * invitation flow provisions), so the useful answer is where to go instead.
 */
function userChangeRefusal(error: unknown): string {
  if (isApiError(error) && error.code === 'two_factor_required') {
    return 'Administrators must enrol an authenticator, so the role is given by invitation only. Use “Invite staff member”.';
  }
  if (isApiError(error) && error.kind === 'forbidden') {
    return 'The platform refused this change. You cannot change your own role or status, and the action needs the roles permission.';
  }
  return adminRefusal(error);
}

/**
 * Users & Permissions (ADM-09, FE-10.10) — every account on the platform,
 * its role and whether it may sign in. Search and the role filter are the
 * server's (API §2.10), so they reach accounts beyond what is on screen.
 *
 * Each change is written alone and the row re-renders from the server's
 * answer: several refusals — your own account, the last administrator, a
 * role that needs a second factor — leave the row as it was, and an
 * optimistic copy would show a role the platform never granted.
 */
export function UsersPanel() {
  const { user } = useAuth();
  const { toast } = useToast();
  const info = meta('users');
  const [search, setSearch] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  const role = roleFilterFrom(searchParams);
  const setRole = (next: string) =>
    setSearchParams(
      (current) => {
        const params = new URLSearchParams(current);
        if (next === 'all') params.delete('role');
        else params.set('role', next);
        return params;
      },
      { replace: true },
    );
  const debouncedSearch = useDebouncedValue(search);
  const users = useAccessUsers({ search: debouncedSearch, role });
  // Custom roles (API §15.4) arrive as codes; the server's role list names
  // them. Falls back to the code if the list has not answered.
  const roles = useAccessRoles();
  const labelFor = (code: string) =>
    roles.data?.find((entry) => entry.code === code)?.label ?? roleLabel(code);
  const update = useUpdateAccessUserMutation();
  const invite = useInviteStaffMutation();
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const mutate = (account: AccessUser, changes: { role?: string; active?: boolean }) => {
    update.mutate(
      { id: account.id, changes },
      {
        onSuccess: (next) =>
          toast({
            variant: 'success',
            title: `${next.name} updated`,
            description: `${labelFor(next.role)} · ${next.active ? 'active' : 'deactivated'}`,
          }),
        onError: (error) =>
          toast({
            variant: 'error',
            title: `Could not update ${account.name}`,
            description: userChangeRefusal(error),
          }),
      },
    );
  };

  const sendInvitation = (email: string, invitedRole: InvitableRole) => {
    setInviteError(null);
    invite.mutate(
      { email, role: invitedRole },
      {
        onSuccess: (sent) => {
          setInviting(false);
          toast({
            variant: 'success',
            title: 'Invitation sent',
            description: `${sent.email} can accept until ${formatDateTime(sent.expiresAt)}.`,
          });
        },
        onError: (error) => setInviteError(adminRefusal(error)),
      },
    );
  };

  const rows = users.data ?? [];

  return (
    <Panel
      title={info.label}
      description={info.description}
      icon={info.icon}
      action={
        <Button
          size="sm"
          leadingIcon={UserPlus}
          onClick={() => {
            setInviteError(null);
            setInviting(true);
          }}
        >
          Invite staff member
        </Button>
      }
    >
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <div className="sm:flex-1">
          <SearchInput
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onClear={() => setSearch('')}
            placeholder="Search name or email"
            aria-label="Search accounts"
          />
        </div>
        <Select
          aria-label="Filter by role"
          value={role}
          onChange={setRole}
          options={ROLE_FILTER_OPTIONS}
          containerClassName="sm:w-48"
        />
      </div>

      <AsyncSection
        isLoading={users.isLoading}
        isError={users.isError}
        error={users.error}
        onRetry={() => void users.refetch()}
      >
        {rows.length === 0 ? (
          <GridEmpty>
            {debouncedSearch.trim().length > 0 || role !== 'all'
              ? 'No accounts match these filters.'
              : 'No accounts yet.'}
          </GridEmpty>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {rows.map((account) => {
              const isSelf = account.email === user?.email;
              const busy = update.isPending && update.variables.id === account.id;
              const options = (PLATFORM_ROLES as readonly string[]).includes(account.role)
                ? PLATFORM_ROLES.map((code) => ({ value: code, label: PLATFORM_ROLE_LABEL[code] }))
                : [
                    { value: account.role, label: labelFor(account.role) },
                    ...PLATFORM_ROLES.map((code) => ({
                      value: code,
                      label: PLATFORM_ROLE_LABEL[code],
                    })),
                  ];
              return (
                <li
                  key={account.id}
                  className="flex flex-col gap-3 py-3.5 first:pt-0 last:pb-0 sm:flex-row sm:items-center"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <Avatar name={account.name} size="sm" decorative />
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 truncate text-body-sm font-medium text-text-primary">
                        {account.name}
                        {isSelf ? <Badge variant="info">You</Badge> : null}
                        {account.active ? null : <Badge variant="neutral">Deactivated</Badge>}
                      </p>
                      <p className="truncate text-caption text-text-tertiary">
                        {account.email} ·{' '}
                        {account.lastActiveAt === null
                          ? 'never signed in'
                          : `last active ${formatDate(account.lastActiveAt)}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <Select
                      aria-label={`Role for ${account.name}`}
                      value={account.role}
                      disabled={isSelf || busy}
                      onChange={(value) => {
                        if (value !== account.role) mutate(account, { role: value });
                      }}
                      options={options}
                      containerClassName="w-40"
                    />
                    <Switch
                      aria-label={`${account.name} active`}
                      checked={account.active}
                      disabled={isSelf || busy}
                      onCheckedChange={(checked) => mutate(account, { active: checked })}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </AsyncSection>
      <p className="mt-3 text-caption text-text-secondary">
        Your own account can’t be demoted or deactivated from here. Deactivating an account signs it
        out everywhere.
      </p>

      <InviteStaffDialog
        open={inviting}
        submitting={invite.isPending}
        error={inviteError}
        onClose={() => {
          setInviting(false);
          setInviteError(null);
        }}
        onConfirm={sendInvitation}
      />
    </Panel>
  );
}

/* ── API keys ─────────────────────────────────────────────────── */

export function ApiKeysPanel({ document }: { document: AdminSettingsDocument }) {
  const { toast } = useToast();
  const create = useCreateApiKeyMutation();
  const revoke = useRevokeApiKeyMutation();
  const info = meta('api-keys');

  const [label, setLabel] = useState('');
  const [labelError, setLabelError] = useState<string | undefined>(undefined);
  const [secret, setSecret] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null);

  const createKey = () => {
    const trimmed = label.trim();
    if (trimmed.length < 3) {
      setLabelError('At least 3 characters');
      return;
    }
    setLabelError(undefined);
    create.mutate(trimmed, {
      onSuccess: (created) => {
        setLabel('');
        setSecret(created.secret);
      },
      onError: () => toast({ variant: 'error', title: 'Could not create the key' }),
    });
  };

  const copySecret = () => {
    if (secret === null) return;
    void copyText(secret).then(
      () => toast({ variant: 'success', title: 'Key copied to clipboard' }),
      () => toast({ variant: 'error', title: 'Could not copy the key' }),
    );
  };

  return (
    <Panel title={info.label} description={info.description} icon={info.icon}>
      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          createKey();
        }}
      >
        <Input
          label="New key label"
          placeholder="e.g. Reporting export"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          error={labelError}
          containerClassName="flex-1 sm:max-w-xs"
        />
        <Button type="submit" size="md" leadingIcon={Plus} loading={create.isPending}>
          Create key
        </Button>
      </form>

      <ul className="mt-4 flex flex-col divide-y divide-border">
        {document.apiKeys.map((key) => (
          <li
            key={key.id}
            className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
          >
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-body-sm font-medium text-text-primary">
                <KeyRound
                  aria-hidden="true"
                  className="h-4 w-4 text-text-tertiary"
                  strokeWidth={1.75}
                />
                {key.label}
                {key.revoked ? (
                  <Badge variant="neutral">Revoked</Badge>
                ) : (
                  <Badge variant="success">Active</Badge>
                )}
              </p>
              <p className="mt-0.5 font-mono text-caption text-text-tertiary">
                {key.prefix}···· · created {formatDate(key.createdAt)}
                {key.lastUsedAt ? ` · last used ${formatDate(key.lastUsedAt)}` : ' · never used'}
              </p>
            </div>
            {!key.revoked ? (
              <Button
                variant="ghost"
                size="sm"
                leadingIcon={ShieldOff}
                onClick={() => setRevokeTarget(key.id)}
              >
                Revoke
              </Button>
            ) : null}
          </li>
        ))}
      </ul>

      <Modal
        open={secret !== null}
        onClose={() => setSecret(null)}
        title="API key created"
        description="Copy it now — for security it is shown only once."
        footer={
          <>
            <Button variant="secondary" leadingIcon={Copy} onClick={copySecret}>
              Copy key
            </Button>
            <Button onClick={() => setSecret(null)}>Done</Button>
          </>
        }
      >
        <code className="block break-all rounded-surface bg-surface-sunken px-3 py-2 font-mono text-body-sm text-text-primary">
          {secret}
        </code>
      </Modal>

      <ConfirmationDialog
        open={revokeTarget !== null}
        onClose={() => setRevokeTarget(null)}
        onConfirm={() => {
          if (revokeTarget !== null) {
            revoke.mutate(revokeTarget, {
              onError: () => toast({ variant: 'error', title: 'Could not revoke the key' }),
            });
          }
          setRevokeTarget(null);
        }}
        title="Revoke this API key?"
        description="Requests using this key stop working immediately. This cannot be undone."
        confirmLabel="Revoke key"
      />
    </Panel>
  );
}

/* ── Audit logs ───────────────────────────────────────────────── */

const AUDIT_SEVERITY_VARIANT = {
  info: 'info',
  warning: 'warning',
  critical: 'error',
} as const;

export function AuditPanel() {
  const query = useAuditEvents();
  const info = meta('audit');

  return (
    <Panel title={info.label} description={info.description} icon={info.icon}>
      <AsyncSection
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        onRetry={() => void query.refetch()}
      >
        <ul className="flex flex-col divide-y divide-border">
          {(query.data ?? []).map((event: AuditEvent) => (
            <li key={event.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
              <Badge variant={AUDIT_SEVERITY_VARIANT[event.severity]} dot>
                {event.severity}
              </Badge>
              <div className="min-w-0 flex-1">
                <p className="text-body-sm font-medium text-text-primary">{event.action}</p>
                <p className="mt-0.5 truncate text-caption text-text-secondary">
                  {event.actor} · {event.target}
                </p>
              </div>
              <time className="shrink-0 text-caption text-text-tertiary tabular-nums">
                {formatDateTime(event.at)}
              </time>
            </li>
          ))}
        </ul>
      </AsyncSection>
    </Panel>
  );
}
