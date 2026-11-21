import { Grid } from '@/components/layout';
import { Input, Switch, Textarea } from '@/components/ui';

import { SETTINGS_PANELS, type AdminSettingsDocument } from '../../admin-settings.types';
import { useResetSectionMutation, useSaveSectionMutation } from '../../api/useAdminSettingsQueries';
import { SettingsPanelForm } from '../../components/SettingsPanelForm';

/**
 * Communication-group settings panels (Phase 18): Notifications, Email,
 * SMS. Channel toggles and delivery configuration through the shared
 * SettingsPanelForm envelope.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function meta(id: string) {
  const found = SETTINGS_PANELS.find((panel) => panel.id === id);
  if (!found) throw new Error(`Unknown settings panel: ${id}`);
  return found;
}

export function NotificationsPanel({ document }: { document: AdminSettingsDocument }) {
  const save = useSaveSectionMutation('notifications');
  const reset = useResetSectionMutation('notifications');
  const info = meta('notifications');

  return (
    <SettingsPanelForm
      title={info.label}
      description={info.description}
      icon={info.icon}
      value={document.notifications}
      validate={(draft) => ({
        ...(TIME_RE.test(draft.quietFrom) ? {} : { quietFrom: 'Use HH:MM' }),
        ...(TIME_RE.test(draft.quietTo) ? {} : { quietTo: 'Use HH:MM' }),
      })}
      onSave={(draft) => save.mutateAsync(draft)}
      onResetDefaults={() => reset.mutateAsync()}
      saving={save.isPending}
      resetting={reset.isPending}
    >
      {({ draft, patch, errors }) => (
        <>
          <div className="flex flex-col divide-y divide-border">
            <div className="pb-3">
              <Switch
                label="Email notifications"
                description="Appointment, lab, and system events by email."
                checked={draft.emailEnabled}
                onCheckedChange={(checked) => patch({ emailEnabled: checked })}
              />
            </div>
            <div className="py-3">
              <Switch
                label="SMS notifications"
                description="Reminders and critical alerts by text message."
                checked={draft.smsEnabled}
                onCheckedChange={(checked) => patch({ smsEnabled: checked })}
              />
            </div>
            <div className="py-3">
              <Switch
                label="In-app notifications"
                description="The notification center inside Medora."
                checked={draft.inAppEnabled}
                onCheckedChange={(checked) => patch({ inAppEnabled: checked })}
              />
            </div>
            <div className="py-3">
              <Switch
                label="Daily digest"
                description="One summary email each morning instead of individual messages."
                checked={draft.dailyDigest}
                onCheckedChange={(checked) => patch({ dailyDigest: checked })}
              />
            </div>
            <div className="pt-3">
              <Switch
                label="Critical alerts only"
                description="Suppress routine notifications platform-wide."
                checked={draft.criticalOnly}
                onCheckedChange={(checked) => patch({ criticalOnly: checked })}
              />
            </div>
          </div>
          <Grid columns={{ base: 1, md: 2 }} gap={4}>
            <Input
              label="Quiet hours start"
              type="time"
              value={draft.quietFrom}
              onChange={(event) => patch({ quietFrom: event.target.value })}
              error={errors.quietFrom}
            />
            <Input
              label="Quiet hours end"
              type="time"
              value={draft.quietTo}
              onChange={(event) => patch({ quietTo: event.target.value })}
              error={errors.quietTo}
            />
          </Grid>
        </>
      )}
    </SettingsPanelForm>
  );
}

export function EmailPanel({ document }: { document: AdminSettingsDocument }) {
  const save = useSaveSectionMutation('email');
  const reset = useResetSectionMutation('email');
  const info = meta('email');

  return (
    <SettingsPanelForm
      title={info.label}
      description={info.description}
      icon={info.icon}
      value={document.email}
      validate={(draft) => ({
        ...(draft.fromName.trim() ? {} : { fromName: 'Enter a sender name' }),
        ...(EMAIL_RE.test(draft.fromAddress) ? {} : { fromAddress: 'Enter a valid email' }),
        ...(draft.replyTo === '' || EMAIL_RE.test(draft.replyTo)
          ? {}
          : { replyTo: 'Enter a valid email' }),
        ...(draft.smtpHost.trim() ? {} : { smtpHost: 'Enter the SMTP host' }),
        ...(draft.smtpPort >= 1 && draft.smtpPort <= 65_535
          ? {}
          : { smtpPort: 'Port must be 1–65535' }),
      })}
      onSave={(draft) => save.mutateAsync(draft)}
      onResetDefaults={() => reset.mutateAsync()}
      saving={save.isPending}
      resetting={reset.isPending}
    >
      {({ draft, patch, errors }) => (
        <>
          <Grid columns={{ base: 1, md: 2 }} gap={4}>
            <Input
              label="From name"
              required
              value={draft.fromName}
              onChange={(event) => patch({ fromName: event.target.value })}
              error={errors.fromName}
            />
            <Input
              label="From address"
              type="email"
              required
              value={draft.fromAddress}
              onChange={(event) => patch({ fromAddress: event.target.value })}
              error={errors.fromAddress}
            />
            <Input
              label="Reply-to"
              type="email"
              value={draft.replyTo}
              onChange={(event) => patch({ replyTo: event.target.value })}
              error={errors.replyTo}
            />
            <Input
              label="SMTP host"
              required
              value={draft.smtpHost}
              onChange={(event) => patch({ smtpHost: event.target.value })}
              error={errors.smtpHost}
            />
            <Input
              label="SMTP port"
              type="number"
              min={1}
              max={65535}
              required
              value={String(draft.smtpPort)}
              onChange={(event) => patch({ smtpPort: Number(event.target.value) })}
              error={errors.smtpPort}
            />
          </Grid>
          <Textarea
            label="Signature"
            rows={2}
            helperText="Appended to every outgoing platform email."
            value={draft.signature}
            onChange={(event) => patch({ signature: event.target.value })}
          />
        </>
      )}
    </SettingsPanelForm>
  );
}

export function SmsPanel({ document }: { document: AdminSettingsDocument }) {
  const save = useSaveSectionMutation('sms');
  const reset = useResetSectionMutation('sms');
  const info = meta('sms');

  return (
    <SettingsPanelForm
      title={info.label}
      description={info.description}
      icon={info.icon}
      value={document.sms}
      validate={(draft) => ({
        ...(/^[A-Za-z0-9]{1,11}$/.test(draft.senderId)
          ? {}
          : { senderId: 'Up to 11 letters or digits' }),
        ...(/^\+\d{1,3}$/.test(draft.defaultCountryCode)
          ? {}
          : { defaultCountryCode: 'Use +<code>, e.g. +1' }),
      })}
      onSave={(draft) => save.mutateAsync(draft)}
      onResetDefaults={() => reset.mutateAsync()}
      saving={save.isPending}
      resetting={reset.isPending}
    >
      {({ draft, patch, errors }) => (
        <>
          <Switch
            label="SMS delivery"
            description="Send appointment reminders and alerts by text message."
            checked={draft.enabled}
            onCheckedChange={(checked) => patch({ enabled: checked })}
          />
          <Grid columns={{ base: 1, md: 2 }} gap={4}>
            <Input
              label="Sender ID"
              required
              helperText="Shown as the message sender on patients’ phones."
              value={draft.senderId}
              onChange={(event) => patch({ senderId: event.target.value })}
              error={errors.senderId}
            />
            <Input
              label="Default country code"
              required
              value={draft.defaultCountryCode}
              onChange={(event) => patch({ defaultCountryCode: event.target.value })}
              error={errors.defaultCountryCode}
            />
          </Grid>
          <Switch
            label="Delivery reports"
            description="Track whether each message reached the handset."
            checked={draft.deliveryReports}
            onCheckedChange={(checked) => patch({ deliveryReports: checked })}
          />
        </>
      )}
    </SettingsPanelForm>
  );
}
