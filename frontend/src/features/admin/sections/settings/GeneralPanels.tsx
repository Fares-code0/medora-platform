import { Grid } from '@/components/layout';
import { Input, Select, Switch, Textarea } from '@/components/ui';
import { useT } from '@/i18n';

import { SETTINGS_PANELS, type AdminSettingsDocument } from '../../admin-settings.types';
import { adminSectionOptions, resolveLandingSection } from '../../administration.meta';
import { useResetSectionMutation, useSaveSectionMutation } from '../../api/useAdminSettingsQueries';
import { SettingsPanelForm } from '../../components/SettingsPanelForm';

/**
 * Organization-group settings panels (Phase 18): General, Organization,
 * Branding, Localization. Each edits one document slice through the shared
 * SettingsPanelForm envelope (draft, validation, save/undo/reset).
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/\S+$/;

function meta(id: string) {
  const found = SETTINGS_PANELS.find((panel) => panel.id === id);
  if (!found) throw new Error(`Unknown settings panel: ${id}`);
  return found;
}

export function GeneralPanel({ document }: { document: AdminSettingsDocument }) {
  const save = useSaveSectionMutation('general');
  const reset = useResetSectionMutation('general');
  const info = meta('general');

  const t = useT();
  const sectionOptions = adminSectionOptions(t);

  return (
    <SettingsPanelForm
      title={info.label}
      description={info.description}
      icon={info.icon}
      value={{ ...document.general, defaultSection: resolveLandingSection(document.general.defaultSection) }}
      validate={(draft) => ({
        ...(draft.platformName.trim() ? {} : { platformName: 'Enter a platform name' }),
        ...(EMAIL_RE.test(draft.supportEmail) ? {} : { supportEmail: 'Enter a valid email' }),
        ...(draft.maintenanceMode && !draft.maintenanceMessage.trim()
          ? { maintenanceMessage: 'Describe the maintenance window' }
          : {}),
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
              label="Platform name"
              required
              value={draft.platformName}
              onChange={(event) => patch({ platformName: event.target.value })}
              error={errors.platformName}
            />
            <Input
              label="Support email"
              type="email"
              required
              value={draft.supportEmail}
              onChange={(event) => patch({ supportEmail: event.target.value })}
              error={errors.supportEmail}
            />
            <Select
              label="Default landing section"
              // A document saved before ADM-01 can name a section that no
              // longer exists; the select would then show nothing at all.
              value={resolveLandingSection(draft.defaultSection)}
              onChange={(value) =>
                patch({
                  defaultSection: value as AdminSettingsDocument['general']['defaultSection'],
                })
              }
              options={sectionOptions}
            />
          </Grid>
          <Switch
            label="Maintenance mode"
            description="Shows the maintenance banner to non-admin users."
            checked={draft.maintenanceMode}
            onCheckedChange={(checked) => patch({ maintenanceMode: checked })}
          />
          <Textarea
            label="Maintenance message"
            rows={2}
            value={draft.maintenanceMessage}
            onChange={(event) => patch({ maintenanceMessage: event.target.value })}
            error={errors.maintenanceMessage}
          />
        </>
      )}
    </SettingsPanelForm>
  );
}

export function OrganizationPanel({ document }: { document: AdminSettingsDocument }) {
  const save = useSaveSectionMutation('organization');
  const reset = useResetSectionMutation('organization');
  const info = meta('organization');

  return (
    <SettingsPanelForm
      title={info.label}
      description={info.description}
      icon={info.icon}
      value={document.organization}
      validate={(draft) => ({
        ...(draft.name.trim() ? {} : { name: 'Enter the organization name' }),
        ...(draft.legalName.trim() ? {} : { legalName: 'Enter the legal name' }),
        ...(draft.website === '' || URL_RE.test(draft.website)
          ? {}
          : { website: 'Enter a full URL (https://…)' }),
      })}
      onSave={(draft) => save.mutateAsync(draft)}
      onResetDefaults={() => reset.mutateAsync()}
      saving={save.isPending}
      resetting={reset.isPending}
    >
      {({ draft, patch, errors }) => (
        <Grid columns={{ base: 1, md: 2 }} gap={4}>
          <Input
            label="Organization name"
            required
            value={draft.name}
            onChange={(event) => patch({ name: event.target.value })}
            error={errors.name}
          />
          <Input
            label="Legal name"
            required
            value={draft.legalName}
            onChange={(event) => patch({ legalName: event.target.value })}
            error={errors.legalName}
          />
          <Input
            label="Tax ID"
            value={draft.taxId}
            onChange={(event) => patch({ taxId: event.target.value })}
          />
          <Input
            label="Phone"
            value={draft.phone}
            onChange={(event) => patch({ phone: event.target.value })}
          />
          <Input
            label="Website"
            type="url"
            placeholder="https://…"
            value={draft.website}
            onChange={(event) => patch({ website: event.target.value })}
            error={errors.website}
          />
          <Input
            label="Address"
            value={draft.addressLine}
            onChange={(event) => patch({ addressLine: event.target.value })}
          />
          <Input
            label="City"
            value={draft.city}
            onChange={(event) => patch({ city: event.target.value })}
          />
          <Input
            label="Country"
            value={draft.country}
            onChange={(event) => patch({ country: event.target.value })}
          />
        </Grid>
      )}
    </SettingsPanelForm>
  );
}

export function BrandingPanel({ document }: { document: AdminSettingsDocument }) {
  const save = useSaveSectionMutation('branding');
  const reset = useResetSectionMutation('branding');
  const info = meta('branding');

  return (
    <SettingsPanelForm
      title={info.label}
      description={info.description}
      icon={info.icon}
      value={document.branding}
      validate={(draft) => ({
        ...(draft.productName.trim() ? {} : { productName: 'Enter a product name' }),
        ...(draft.loginWelcome.trim() ? {} : { loginWelcome: 'Enter a sign-in headline' }),
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
              label="Product name"
              required
              value={draft.productName}
              onChange={(event) => patch({ productName: event.target.value })}
              error={errors.productName}
            />
            <Input
              label="Sign-in headline"
              required
              value={draft.loginWelcome}
              onChange={(event) => patch({ loginWelcome: event.target.value })}
              error={errors.loginWelcome}
            />
          </Grid>
          <Textarea
            label="Tagline"
            rows={2}
            helperText="Shown under the wordmark on the sign-in page."
            value={draft.tagline}
            onChange={(event) => patch({ tagline: event.target.value })}
          />
          <Switch
            label="Show “Powered by Medora”"
            description="Displays platform attribution in the sign-in footer."
            checked={draft.showPoweredBy}
            onCheckedChange={(checked) => patch({ showPoweredBy: checked })}
          />
        </>
      )}
    </SettingsPanelForm>
  );
}

const TIMEZONES = [
  'America/Los_Angeles',
  'America/New_York',
  'Europe/London',
  'Europe/Berlin',
  'Asia/Dubai',
] as const;

export function LocalizationPanel({ document }: { document: AdminSettingsDocument }) {
  const save = useSaveSectionMutation('localization');
  const reset = useResetSectionMutation('localization');
  const info = meta('localization');

  return (
    <SettingsPanelForm
      title={info.label}
      description={info.description}
      icon={info.icon}
      value={document.localization}
      onSave={(draft) => save.mutateAsync(draft)}
      onResetDefaults={() => reset.mutateAsync()}
      saving={save.isPending}
      resetting={reset.isPending}
    >
      {({ draft, patch }) => (
        <Grid columns={{ base: 1, md: 2 }} gap={4}>
          <Select
            label="Language"
            value={draft.language}
            onChange={() => patch({ language: 'en' })}
            options={[{ value: 'en', label: 'English' }]}
            helperText="More languages arrive with the localization program."
          />
          <Select
            label="Timezone"
            value={draft.timezone}
            onChange={(value) => patch({ timezone: value })}
            options={TIMEZONES.map((zone) => ({ value: zone, label: zone.replace('_', ' ') }))}
          />
          <Select
            label="Date format"
            value={draft.dateFormat}
            onChange={(value) => patch({ dateFormat: value as typeof draft.dateFormat })}
            options={[
              { value: 'DMY', label: '31 Dec 2026' },
              { value: 'MDY', label: 'Dec 31, 2026' },
              { value: 'ISO', label: '2026-12-31' },
            ]}
          />
          <Select
            label="Time format"
            value={draft.timeFormat}
            onChange={(value) => patch({ timeFormat: value as typeof draft.timeFormat })}
            options={[
              { value: '12h', label: '12-hour (2:30 PM)' },
              { value: '24h', label: '24-hour (14:30)' },
            ]}
          />
          <Select
            label="First day of week"
            value={draft.firstDayOfWeek}
            onChange={(value) => patch({ firstDayOfWeek: value as typeof draft.firstDayOfWeek })}
            options={[
              { value: 'monday', label: 'Monday' },
              { value: 'sunday', label: 'Sunday' },
            ]}
          />
          <Select
            label="Currency"
            value={draft.currency}
            onChange={(value) => patch({ currency: value as typeof draft.currency })}
            options={[
              { value: 'USD', label: 'USD — US Dollar' },
              { value: 'EUR', label: 'EUR — Euro' },
              { value: 'GBP', label: 'GBP — British Pound' },
            ]}
          />
        </Grid>
      )}
    </SettingsPanelForm>
  );
}
