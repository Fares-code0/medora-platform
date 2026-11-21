import {
  CalendarClock,
  FlaskConical,
  LayoutDashboard,
  MessagesSquare,
  Save,
  Users,
} from 'lucide-react';

import { useToast } from '@/app/providers';
import { Select, Switch } from '@/components/ui';

import { useSaveWorkflowMutation } from '../api/useSettingsQueries';
import { OptionCards } from '../components/OptionCards';
import { SettingsCard } from '../components/SettingsCard';
import { SettingsRow } from '../components/SettingsRow';
import { StickySaveBar } from '../components/StickySaveBar';
import { useEditableSection } from '../hooks/useEditableSection';
import type {
  DateFormat,
  LandingPage,
  PatientTab,
  RecordsTab,
  SettingsDocument,
  TimeFormat,
  WorkflowPreferences,
} from '../model/types';

/**
 * Preferences section — workflow defaults (landing page, default tabs,
 * date/time formats, timezone, draft autosave) behind the sticky save bar.
 * The landing-page choice is honored by the app's root redirect so it's a
 * real preference, not decoration.
 */

const TIMEZONES: readonly string[] = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Berlin',
  'Asia/Dubai',
  'Asia/Singapore',
  'Australia/Sydney',
  'UTC',
];

const DATE_FORMATS: readonly DateFormat[] = ['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'];

export function PreferencesSection({ document }: { document: SettingsDocument }) {
  const { toast } = useToast();
  const saveWorkflow = useSaveWorkflowMutation();
  const { draft, patch, dirty, reset } = useEditableSection<WorkflowPreferences>(document.workflow);

  const save = () => {
    saveWorkflow.mutate(draft, {
      onSuccess: () => toast({ variant: 'success', title: 'Preferences saved' }),
      onError: () =>
        toast({ variant: 'error', title: 'Could not save', description: 'Please try again.' }),
    });
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
      className="flex flex-col gap-5"
    >
      <SettingsCard
        title="Default landing page"
        description="Where Medora takes you after signing in."
        icon={LayoutDashboard}
      >
        <OptionCards
          label="Default landing page"
          value={draft.landingPage}
          onChange={(landingPage: LandingPage) => patch({ landingPage })}
          options={[
            { value: 'overview', label: 'Dashboard', icon: LayoutDashboard },
            { value: 'patients', label: 'Patients', icon: Users },
            { value: 'appointments', label: 'Appointments', icon: CalendarClock },
            { value: 'labs', label: 'Labs', icon: FlaskConical },
            { value: 'messages', label: 'Messages', icon: MessagesSquare },
          ]}
        />
      </SettingsCard>

      <SettingsCard
        title="Defaults"
        description="The tab each screen opens on, and how you like drafts handled."
        icon={Save}
      >
        <div className="flex flex-col gap-4">
          <SettingsRow
            title="Default patient tab"
            description="The first tab shown when you open a patient."
            control={
              <Select
                aria-label="Default patient tab"
                containerClassName="w-52"
                value={draft.defaultPatientTab}
                onChange={(value) => patch({ defaultPatientTab: value as PatientTab })}
                options={[
                  { value: 'summary', label: 'Summary' },
                  { value: 'records', label: 'Records' },
                  { value: 'labs', label: 'Labs' },
                  { value: 'prescriptions', label: 'Prescriptions' },
                ]}
              />
            }
          />
          <SettingsRow
            title="Default records tab"
            description="The default filter on the medical records list."
            control={
              <Select
                aria-label="Default records tab"
                containerClassName="w-52"
                value={draft.defaultRecordsTab}
                onChange={(value) => patch({ defaultRecordsTab: value as RecordsTab })}
                options={[
                  { value: 'all', label: 'All records' },
                  { value: 'recent', label: 'Recent' },
                  { value: 'critical', label: 'Critical' },
                ]}
              />
            }
          />
          <SettingsRow
            title="Auto-save drafts"
            description="Automatically keep drafts of notes and messages as you type."
            control={
              <Switch
                aria-label="Auto-save drafts"
                checked={draft.autoSaveDrafts}
                onCheckedChange={(checked) => patch({ autoSaveDrafts: checked })}
              />
            }
          />
        </div>
      </SettingsCard>

      <SettingsCard
        title="Date & time"
        description="How dates and times display across Medora."
        icon={CalendarClock}
      >
        <div className="flex flex-col gap-4">
          <SettingsRow
            title="Date format"
            control={
              <Select
                aria-label="Date format"
                containerClassName="w-52"
                value={draft.dateFormat}
                onChange={(value) => patch({ dateFormat: value as DateFormat })}
                options={DATE_FORMATS.map((format) => ({ value: format, label: format }))}
              />
            }
          />
          <SettingsRow
            title="Time format"
            control={
              <Select
                aria-label="Time format"
                containerClassName="w-52"
                value={draft.timeFormat}
                onChange={(value) => patch({ timeFormat: value as TimeFormat })}
                options={[
                  { value: '12h', label: '12-hour (1:30 PM)' },
                  { value: '24h', label: '24-hour (13:30)' },
                ]}
              />
            }
          />
          <SettingsRow
            title="Timezone"
            control={
              <Select
                aria-label="Timezone"
                containerClassName="w-52"
                value={draft.timezone}
                onChange={(value) => patch({ timezone: value })}
                options={TIMEZONES.map((zone) => ({ value: zone, label: zone.replace('_', ' ') }))}
              />
            }
          />
        </div>
      </SettingsCard>

      <StickySaveBar
        visible={dirty}
        saving={saveWorkflow.isPending}
        onSave={save}
        onCancel={reset}
      />
    </form>
  );
}
