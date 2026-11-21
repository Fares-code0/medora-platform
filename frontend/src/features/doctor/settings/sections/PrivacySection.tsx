import { useState } from 'react';

import { Database, Download, ShieldCheck, Trash2, TriangleAlert } from 'lucide-react';

import { useAuth, useDoctorProfile, useToast } from '@/app/providers';
import { Button, ConfirmationDialog, Switch } from '@/components/ui';

import { useSettingsQuery, useUpdatePrivacyMutation } from '../api/useSettingsQueries';
import { SettingsCard } from '../components/SettingsCard';
import { SettingsRow, SettingsRowList } from '../components/SettingsRow';
import { StickySaveBar } from '../components/StickySaveBar';
import { useEditableSection } from '../hooks/useEditableSection';
import { SettingsConflictError } from '../model/settings-service';
import type { PrivacySettings, SettingsDocument } from '../model/types';
import { settingsService } from '../service';

/**
 * Privacy section — data-sharing toggles behind the sticky save bar, plus
 * the data-rights actions: a client-side "download my data" export and a
 * gated "delete account" confirmation. Deletion is UI-only in the mock; the
 * dialog states the consequence and the demo surfaces that no data is
 * actually removed. Live, the consents are the server's (RM M22, `PATCH
 * /me/settings/privacy`), and the danger zone is absent: no route deletes an
 * account (`capabilities.accountDeletion`).
 *
 * A save that the server refuses as stale (409 — the settings changed in
 * another tab or device since this one read them) is said as such and the
 * document reloaded, so the switches show what is actually stored before
 * the doctor decides again.
 */

const TOGGLES: readonly {
  key: keyof PrivacySettings;
  title: string;
  description: string;
}[] = [
  {
    key: 'dataSharing',
    title: 'Share profile with in-network providers',
    description: 'Let other Medora providers see your professional profile for referrals.',
  },
  {
    key: 'analytics',
    title: 'Product analytics',
    description: 'Help improve Medora with anonymous usage analytics.',
  },
  {
    key: 'cookies',
    title: 'Functional cookies',
    description: 'Remember preferences and keep you signed in across visits.',
  },
  {
    key: 'aiDataUsage',
    title: 'AI model improvement',
    description: 'Allow de-identified interactions to improve AI assistance. Off by default.',
  },
];

export function PrivacySection({ document }: { document: SettingsDocument }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const { profile } = useDoctorProfile();
  const updatePrivacy = useUpdatePrivacyMutation();
  const settingsQuery = useSettingsQuery();
  const refetchSettings = settingsQuery.refetch;
  const { draft, setDraft, patch, dirty, reset } = useEditableSection<PrivacySettings>(
    document.privacy,
  );
  const [confirmDelete, setConfirmDelete] = useState(false);

  const save = () => {
    updatePrivacy.mutate(draft, {
      onSuccess: () => toast({ variant: 'success', title: 'Privacy preferences saved' }),
      onError: (error) => {
        if (error instanceof SettingsConflictError) {
          toast({
            variant: 'error',
            title: 'Your privacy settings changed elsewhere',
            description:
              'Nothing was saved. The current settings are shown — review them and save again.',
          });
          // Re-read, then show what is stored. The draft must be replaced
          // explicitly: when the stored consents equal the ones this screen
          // loaded, the document does not change and the draft would keep
          // the unsaved edit — under a toast saying it shows what is stored.
          void refetchSettings().then((result) => {
            if (result.data) setDraft(result.data.privacy);
          });
          return;
        }
        toast({ variant: 'error', title: 'Could not save', description: 'Please try again.' });
      },
    });
  };

  const downloadData = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      account: { id: user?.id ?? 'anonymous', email: document.account.email },
      profile,
      privacy: document.privacy,
      workflow: document.workflow,
      integrations: document.integrations,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement('a');
    anchor.href = url;
    anchor.download = 'medora-my-data.json';
    anchor.click();
    URL.revokeObjectURL(url);
    toast({ variant: 'success', title: 'Export started', description: 'medora-my-data.json' });
  };

  return (
    <div className="flex flex-col gap-5">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <SettingsCard
          title="Data sharing"
          description="Control how your data is used across Medora."
          icon={ShieldCheck}
        >
          <SettingsRowList>
            {TOGGLES.map((toggle) => (
              <SettingsRow
                key={toggle.key}
                title={toggle.title}
                description={toggle.description}
                control={
                  <Switch
                    aria-label={toggle.title}
                    checked={draft[toggle.key]}
                    onCheckedChange={(checked) => patch({ [toggle.key]: checked })}
                  />
                }
              />
            ))}
          </SettingsRowList>
        </SettingsCard>
        <StickySaveBar
          visible={dirty}
          saving={updatePrivacy.isPending}
          onSave={save}
          onCancel={reset}
        />
      </form>

      <SettingsCard
        title="Your data"
        description="Export a copy of your account data at any time."
        icon={Database}
      >
        <SettingsRow
          title="Download my data"
          description="A JSON file with your profile, preferences, and integrations."
          control={
            <Button variant="secondary" size="sm" leadingIcon={Download} onClick={downloadData}>
              Download
            </Button>
          }
        />
      </SettingsCard>

      {/* Danger zone — demo only: no route deletes an account. */}
      {settingsService.capabilities.accountDeletion ? (
        <div className="rounded-surface border border-error-subtle bg-error-subtle/40 p-5">
          <div className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-surface bg-error-subtle text-error"
            >
              <TriangleAlert className="h-4 w-4" strokeWidth={1.75} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-h5 font-semibold text-text-primary">Delete account</h2>
              <p className="mt-0.5 max-w-prose text-body-sm text-text-secondary">
                Permanently remove your account and all associated data. This cannot be undone.
              </p>
              <div className="mt-3">
                <Button
                  variant="destructive"
                  size="sm"
                  leadingIcon={Trash2}
                  onClick={() => setConfirmDelete(true)}
                >
                  Delete my account
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmationDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          toast({
            variant: 'info',
            title: 'Deletion is disabled in the demo',
            description: 'No data was removed. This flow is UI-only in Medora’s mock environment.',
          });
        }}
        title="Delete your account?"
        description="This permanently deletes your profile, preferences, and history. This action cannot be undone."
        confirmLabel="Delete account"
      />
    </div>
  );
}
