import { useState } from 'react';

import { Archive, Copy, Download, Mail, Plug, Trash2 } from 'lucide-react';

import { useToast } from '@/app/providers';
import { Grid } from '@/components/layout';
import {
  Badge,
  Button,
  ConfirmationDialog,
  Input,
  LinkButton,
  Select,
  Switch,
} from '@/components/ui';
import { APP_RELEASE_CHANNEL, APP_RELEASE_DATE, APP_VERSION } from '@/constants';
import { copyText } from '@/utils/clipboard';

import {
  SETTINGS_PANELS,
  type AdminSettingsDocument,
  type BackupEntry,
} from '../../admin-settings.types';
import { formatDate } from '../../administration.meta';
import { usePlatformStatus } from '../../api/useAdministrationQueries';
import {
  useAdminSettings,
  useCreateBackupMutation,
  useDeleteBackupMutation,
  useResetSectionMutation,
  useSaveSectionMutation,
  useToggleIntegrationMutation,
} from '../../api/useAdminSettingsQueries';
import { Panel } from '../../components/primitives';
import { SettingsPanelForm } from '../../components/SettingsPanelForm';

/**
 * Data & platform settings panels (Phase 18): Integrations, Backup &
 * Restore, Data Retention, Privacy, About. Backups download as real JSON
 * snapshots of the settings document; every other action mutates the
 * persisted document.
 */

function meta(id: string) {
  const found = SETTINGS_PANELS.find((panel) => panel.id === id);
  if (!found) throw new Error(`Unknown settings panel: ${id}`);
  return found;
}

/* ── Integrations ─────────────────────────────────────────────── */

export function IntegrationsPanel({ document }: { document: AdminSettingsDocument }) {
  const { toast } = useToast();
  const toggle = useToggleIntegrationMutation();
  const info = meta('integrations');

  return (
    <Panel title={info.label} description={info.description} icon={info.icon}>
      <ul className="flex flex-col divide-y divide-border">
        {document.integrations.map((integration) => (
          <li
            key={integration.id}
            className="flex flex-wrap items-center justify-between gap-3 py-3.5 first:pt-0 last:pb-0"
          >
            <div className="flex min-w-0 items-center gap-3">
              <span
                aria-hidden="true"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-surface bg-surface-sunken text-text-secondary"
              >
                <Plug className="h-4 w-4" strokeWidth={1.75} />
              </span>
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-body-sm font-medium text-text-primary">
                  {integration.name}
                  {integration.connected ? (
                    <Badge variant="success" dot>
                      Connected
                    </Badge>
                  ) : (
                    <Badge variant="neutral">Not connected</Badge>
                  )}
                </p>
                <p className="mt-0.5 truncate text-caption text-text-secondary">
                  {integration.description}
                  {integration.lastSyncAt
                    ? ` · last sync ${formatDate(integration.lastSyncAt)}`
                    : ''}
                </p>
              </div>
            </div>
            <Button
              variant={integration.connected ? 'ghost' : 'secondary'}
              size="sm"
              loading={toggle.isPending && toggle.variables === integration.id}
              onClick={() =>
                toggle.mutate(integration.id, {
                  onError: () =>
                    toast({ variant: 'error', title: `Could not update ${integration.name}` }),
                })
              }
            >
              {integration.connected ? 'Disconnect' : 'Connect'}
            </Button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/* ── Backup & restore ─────────────────────────────────────────── */

function downloadBackup(document: AdminSettingsDocument, backup: BackupEntry) {
  const payload = {
    backup: { id: backup.id, label: backup.label, createdAt: backup.createdAt },
    settings: document,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement('a');
  anchor.href = url;
  anchor.download = `medora-backup-${backup.id}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function BackupPanel({ document }: { document: AdminSettingsDocument }) {
  const { toast } = useToast();
  const save = useSaveSectionMutation('backup');
  const reset = useResetSectionMutation('backup');
  const createBackup = useCreateBackupMutation();
  const deleteBackup = useDeleteBackupMutation();
  const info = meta('backup');

  const [deleteTarget, setDeleteTarget] = useState<BackupEntry | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <SettingsPanelForm
        title={info.label}
        description={info.description}
        icon={info.icon}
        value={document.backup}
        validate={(draft) =>
          draft.retainCount >= 1 && draft.retainCount <= 10
            ? {}
            : { retainCount: 'Keep between 1 and 10 backups' }
        }
        onSave={(draft) => save.mutateAsync(draft)}
        onResetDefaults={() => reset.mutateAsync()}
        saving={save.isPending}
        resetting={reset.isPending}
      >
        {({ draft, patch, errors }) => (
          <>
            <Switch
              label="Automatic backups"
              description="Snapshot platform data on a schedule."
              checked={draft.autoBackup}
              onCheckedChange={(checked) => patch({ autoBackup: checked })}
            />
            <Grid columns={{ base: 1, md: 2 }} gap={4}>
              <Select
                label="Frequency"
                value={draft.frequency}
                onChange={(value) => patch({ frequency: value as typeof draft.frequency })}
                options={[
                  { value: 'daily', label: 'Daily' },
                  { value: 'weekly', label: 'Weekly' },
                  { value: 'monthly', label: 'Monthly' },
                ]}
              />
              <Input
                label="Backups to retain"
                type="number"
                min={1}
                max={10}
                value={String(draft.retainCount)}
                onChange={(event) => patch({ retainCount: Number(event.target.value) })}
                error={errors.retainCount}
              />
            </Grid>
          </>
        )}
      </SettingsPanelForm>

      <Panel
        title="Recovery points"
        /*
         * No Restore action: nothing in this client can roll the platform
         * back, and the server's restore answers 501. The old button ended
         * in "Restore complete — platform data verified" over a write that
         * never happened, which is the false success an administrator would
         * act on in an incident.
         */
        description="Download or remove existing backups. Restoring a recovery point is not available from this client yet."
        icon={Archive}
        action={
          <Button
            size="sm"
            leadingIcon={Archive}
            loading={createBackup.isPending}
            onClick={() =>
              createBackup.mutate(undefined, {
                onSuccess: () => toast({ variant: 'success', title: 'Backup created' }),
                onError: () => toast({ variant: 'error', title: 'Could not create a backup' }),
              })
            }
          >
            Back up now
          </Button>
        }
      >
        <ul className="flex flex-col divide-y divide-border">
          {document.backups.map((backup) => (
            <li
              key={backup.id}
              className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
            >
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-body-sm font-medium text-text-primary">
                  {backup.label}
                  <Badge variant={backup.kind === 'automatic' ? 'info' : 'neutral'}>
                    {backup.kind}
                  </Badge>
                </p>
                <p className="mt-0.5 text-caption text-text-tertiary tabular-nums">
                  {formatDate(backup.createdAt)} · {backup.sizeMb} MB
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  leadingIcon={Download}
                  onClick={() => downloadBackup(document, backup)}
                >
                  Download
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  leadingIcon={Trash2}
                  onClick={() => setDeleteTarget(backup)}
                >
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      <ConfirmationDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget !== null) {
            deleteBackup.mutate(deleteTarget.id, {
              onError: () => toast({ variant: 'error', title: 'Could not delete the backup' }),
            });
          }
          setDeleteTarget(null);
        }}
        title="Delete this backup?"
        description="The recovery point is removed permanently. This cannot be undone."
        confirmLabel="Delete backup"
      />
    </div>
  );
}

/* ── Data retention ───────────────────────────────────────────── */

export function RetentionPanel({ document }: { document: AdminSettingsDocument }) {
  const save = useSaveSectionMutation('retention');
  const reset = useResetSectionMutation('retention');
  const info = meta('retention');

  const range = (value: number, min: number, max: number, message: string) =>
    value >= min && value <= max ? undefined : message;

  return (
    <SettingsPanelForm
      title={info.label}
      description={info.description}
      icon={info.icon}
      value={document.retention}
      validate={(draft) => {
        const errors: Record<string, string> = {};
        const records = range(draft.patientRecordYears, 1, 30, 'Between 1 and 30 years');
        const audit = range(draft.auditLogDays, 30, 3650, 'Between 30 and 3650 days');
        const messages = range(draft.messageDays, 30, 3650, 'Between 30 and 3650 days');
        if (records) errors['patientRecordYears'] = records;
        if (audit) errors['auditLogDays'] = audit;
        if (messages) errors['messageDays'] = messages;
        return errors;
      }}
      onSave={(draft) => save.mutateAsync(draft)}
      onResetDefaults={() => reset.mutateAsync()}
      saving={save.isPending}
      resetting={reset.isPending}
    >
      {({ draft, patch, errors }) => (
        <>
          <Grid columns={{ base: 1, md: 3 }} gap={4}>
            <Input
              label="Patient records (years)"
              type="number"
              min={1}
              max={30}
              value={String(draft.patientRecordYears)}
              onChange={(event) => patch({ patientRecordYears: Number(event.target.value) })}
              error={errors.patientRecordYears}
            />
            <Input
              label="Audit logs (days)"
              type="number"
              min={30}
              max={3650}
              value={String(draft.auditLogDays)}
              onChange={(event) => patch({ auditLogDays: Number(event.target.value) })}
              error={errors.auditLogDays}
            />
            <Input
              label="Messages (days)"
              type="number"
              min={30}
              max={3650}
              value={String(draft.messageDays)}
              onChange={(event) => patch({ messageDays: Number(event.target.value) })}
              error={errors.messageDays}
            />
          </Grid>
          <Switch
            label="Automatic purge"
            description="Delete expired data automatically at the end of each retention window."
            checked={draft.autoPurge}
            onCheckedChange={(checked) => patch({ autoPurge: checked })}
          />
        </>
      )}
    </SettingsPanelForm>
  );
}

/* ── Privacy ──────────────────────────────────────────────────── */

export function PrivacyPanel({ document }: { document: AdminSettingsDocument }) {
  const save = useSaveSectionMutation('privacy');
  const reset = useResetSectionMutation('privacy');
  const info = meta('privacy');

  return (
    <SettingsPanelForm
      title={info.label}
      description={info.description}
      icon={info.icon}
      value={document.privacy}
      onSave={(draft) => save.mutateAsync(draft)}
      onResetDefaults={() => reset.mutateAsync()}
      saving={save.isPending}
      resetting={reset.isPending}
    >
      {({ draft, patch }) => (
        <div className="flex flex-col divide-y divide-border">
          <div className="pb-3">
            <Switch
              label="Product analytics"
              description="Anonymous usage analytics to improve Medora."
              checked={draft.productAnalytics}
              onCheckedChange={(checked) => patch({ productAnalytics: checked })}
            />
          </div>
          <div className="py-3">
            <Switch
              label="Error reporting"
              description="Send crash diagnostics to the platform team."
              checked={draft.errorReporting}
              onCheckedChange={(checked) => patch({ errorReporting: checked })}
            />
          </div>
          <div className="py-3">
            <Switch
              label="Cookie banner"
              description="Ask visitors for consent on first visit."
              checked={draft.cookieBanner}
              onCheckedChange={(checked) => patch({ cookieBanner: checked })}
            />
          </div>
          <div className="pt-3">
            <Switch
              label="Data processing agreement accepted"
              description="Confirms the signed DPA covering patient data processing."
              checked={draft.dpaAccepted}
              onCheckedChange={(checked) => patch({ dpaAccepted: checked })}
            />
          </div>
        </div>
      )}
    </SettingsPanelForm>
  );
}

/* ── About ────────────────────────────────────────────────────── */

export function AboutPanel() {
  const { toast } = useToast();
  const settings = useAdminSettings();
  const status = usePlatformStatus();
  const info = meta('about');
  const license = status.data?.license;

  const copyDiagnostics = () => {
    const diagnostics = [
      `Medora ${APP_VERSION} · ${APP_RELEASE_CHANNEL}`,
      `Released ${APP_RELEASE_DATE}`,
      `Organization: ${settings.data?.organization.name ?? 'unknown'}`,
      `License: ${license ? `${license.plan} · ${String(license.seatsUsed)}/${String(license.seatsTotal)} seats` : 'unknown'}`,
      `User agent: ${navigator.userAgent}`,
    ].join('\n');
    void copyText(diagnostics).then(
      () => toast({ variant: 'success', title: 'Diagnostics copied' }),
      () => toast({ variant: 'error', title: 'Could not copy diagnostics' }),
    );
  };

  return (
    <Panel title={info.label} description={info.description} icon={info.icon}>
      <dl className="flex flex-col divide-y divide-border">
        <div className="flex items-center justify-between gap-4 pb-3">
          <dt className="text-body-sm font-medium text-text-primary">Version</dt>
          <dd className="flex items-center gap-2">
            <span className="font-mono text-body-sm text-text-primary">{APP_VERSION}</span>
            <Badge variant="info">{APP_RELEASE_CHANNEL}</Badge>
          </dd>
        </div>
        <div className="flex items-center justify-between gap-4 py-3">
          <dt className="text-body-sm font-medium text-text-primary">Released</dt>
          <dd className="text-body-sm text-text-secondary">{APP_RELEASE_DATE}</dd>
        </div>
        <div className="flex items-center justify-between gap-4 py-3">
          <dt className="text-body-sm font-medium text-text-primary">License</dt>
          <dd className="text-body-sm text-text-secondary">
            {license
              ? `${license.plan} · ${String(license.seatsUsed)} of ${String(license.seatsTotal)} seats · renews ${formatDate(license.renewsOn)}`
              : '—'}
          </dd>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
          <dt className="text-body-sm font-medium text-text-primary">Support</dt>
          <dd className="flex items-center gap-2">
            <LinkButton
              href="mailto:support@medora.health"
              variant="secondary"
              size="sm"
              leadingIcon={Mail}
            >
              Contact support
            </LinkButton>
            <Button variant="secondary" size="sm" leadingIcon={Copy} onClick={copyDiagnostics}>
              Copy diagnostics
            </Button>
          </dd>
        </div>
      </dl>
    </Panel>
  );
}
