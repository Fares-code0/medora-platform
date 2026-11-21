import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { RotateCcw, Undo2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { useToast } from '@/app/providers';
import { Button, ConfirmationDialog } from '@/components/ui';

import { Panel, type Tone } from './primitives';

/**
 * SettingsPanelForm — the editing envelope every admin settings form panel
 * shares (Phase 18). Owns the draft (resynced whenever the persisted slice
 * changes, so saves and resets clear the dirty state reliably under
 * StrictMode), field-level validation on save, the Save / Undo footer that
 * appears only while dirty, and the confirmed "Reset defaults" action.
 */

export interface PanelFormContext<T> {
  readonly draft: T;
  readonly patch: (changes: Partial<T>) => void;
  readonly errors: Partial<Record<keyof T & string, string>>;
}

export interface SettingsPanelFormProps<T extends object> {
  title: string;
  description?: string | undefined;
  icon?: LucideIcon | undefined;
  tone?: Tone | undefined;
  /** The persisted slice this panel edits. */
  value: T;
  /** Field-keyed messages; return an empty object when the draft is valid. */
  validate?: ((draft: T) => Partial<Record<keyof T & string, string>>) | undefined;
  onSave: (draft: T) => Promise<unknown>;
  /** Omit to hide the "Reset defaults" action (e.g. the profile form). */
  onResetDefaults?: (() => Promise<unknown>) | undefined;
  saving: boolean;
  resetting?: boolean | undefined;
  children: (context: PanelFormContext<T>) => ReactNode;
}

export function SettingsPanelForm<T extends object>({
  title,
  description,
  icon,
  tone = 'primary',
  value,
  validate,
  onSave,
  onResetDefaults,
  saving,
  resetting = false,
  children,
}: SettingsPanelFormProps<T>) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<T>(value);
  const [errors, setErrors] = useState<Partial<Record<keyof T & string, string>>>({});
  const [confirmReset, setConfirmReset] = useState(false);

  // Resync the draft whenever the persisted slice changes (save, undo from
  // another tab, reset defaults) — guarded so it never clobbers typing.
  const persistedKey = JSON.stringify(value);
  const lastPersistedKey = useRef(persistedKey);
  useEffect(() => {
    if (lastPersistedKey.current !== persistedKey) {
      lastPersistedKey.current = persistedKey;
      setDraft(value);
      setErrors({});
    }
  }, [persistedKey, value]);

  const dirty = JSON.stringify(draft) !== persistedKey;

  const patch = (changes: Partial<T>) => {
    setDraft((current) => ({ ...current, ...changes }));
  };

  const save = () => {
    const found = validate?.(draft) ?? {};
    setErrors(found);
    if (Object.keys(found).length > 0) {
      toast({
        variant: 'error',
        title: 'Check the highlighted fields',
        description: 'Some values need attention before saving.',
      });
      return;
    }
    onSave(draft).then(
      () => toast({ variant: 'success', title: `${title} saved` }),
      () => toast({ variant: 'error', title: 'Could not save', description: 'Please try again.' }),
    );
  };

  const undo = () => {
    setDraft(value);
    setErrors({});
  };

  const resetDefaults = () => {
    setConfirmReset(false);
    if (!onResetDefaults) return;
    onResetDefaults().then(
      () => toast({ variant: 'success', title: `${title} reset to defaults` }),
      () => toast({ variant: 'error', title: 'Could not reset', description: 'Please try again.' }),
    );
  };

  return (
    <Panel
      title={title}
      description={description}
      icon={icon}
      tone={tone}
      action={
        onResetDefaults ? (
          <Button
            variant="ghost"
            size="sm"
            leadingIcon={RotateCcw}
            loading={resetting}
            onClick={() => setConfirmReset(true)}
          >
            Reset defaults
          </Button>
        ) : undefined
      }
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
        className="flex flex-col gap-4"
      >
        {children({ draft, patch, errors })}

        {dirty ? (
          <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="secondary" size="sm" leadingIcon={Undo2} onClick={undo}>
              Undo changes
            </Button>
            <Button type="submit" size="sm" loading={saving}>
              Save changes
            </Button>
          </div>
        ) : null}
      </form>

      <ConfirmationDialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        onConfirm={resetDefaults}
        title={`Reset ${title.toLowerCase()} to defaults?`}
        description="Your saved values for this panel are replaced with the platform defaults. This cannot be undone."
        confirmLabel="Reset defaults"
      />
    </Panel>
  );
}
