import { useEffect, useState, type ReactNode } from 'react';

import { Button, Drawer } from '@/components/ui';

/**
 * EntityFormDrawer — the create/edit envelope shared by the administration
 * area's record sections (Phase B).
 *
 * Owns the draft, per-field validation on save, the busy state and the
 * footer, so each section only declares its fields. Mirrors
 * `SettingsPanelForm`, which does the same job for the settings slices —
 * the difference is that this one edits one record in a drawer rather than
 * a slice of a settings document.
 */
export interface EntityFormRenderArgs<T> {
  readonly draft: T;
  readonly patch: (changes: Partial<T>) => void;
  readonly errors: Partial<Record<keyof T, string>>;
}

export interface EntityFormDrawerProps<T> {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string | undefined;
  submitLabel?: string;
  /** Initial values; re-synced whenever the drawer opens on a new record. */
  value: T;
  /** Field errors keyed by field name; an empty object means valid. */
  validate?: ((draft: T) => Partial<Record<keyof T, string>>) | undefined;
  onSubmit: (draft: T) => Promise<unknown> | void;
  saving?: boolean;
  children: (args: EntityFormRenderArgs<T>) => ReactNode;
}

export function EntityFormDrawer<T extends object>({
  open,
  onClose,
  title,
  description,
  submitLabel = 'Save',
  value,
  validate,
  onSubmit,
  saving = false,
  children,
}: EntityFormDrawerProps<T>) {
  const [draft, setDraft] = useState<T>(value);
  const [errors, setErrors] = useState<Partial<Record<keyof T, string>>>({});

  // Re-sync when the drawer opens, so editing a different record starts from
  // that record rather than the previous draft. Keyed on the serialized
  // value — a bare object dep would resync on every parent render.
  const serialized = JSON.stringify(value);
  useEffect(() => {
    if (!open) return;
    setDraft(value);
    setErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, serialized]);

  const patch = (changes: Partial<T>) => {
    setDraft((current) => ({ ...current, ...changes }));
  };

  const submit = () => {
    const found = validate ? validate(draft) : {};
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    void Promise.resolve(onSubmit(draft)).then(() => {
      onClose();
    });
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={title}
      size="md"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving}>
            {submitLabel}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {description ? <p className="text-body-sm text-text-secondary">{description}</p> : null}
        {children({ draft, patch, errors })}
      </div>
    </Drawer>
  );
}
