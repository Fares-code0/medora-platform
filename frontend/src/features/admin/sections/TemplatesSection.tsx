import { useState } from 'react';

import { Archive, ArchiveRestore, Copy, Eye, FileText } from 'lucide-react';

import { useToast } from '@/app/providers';
import { Badge, Button, Drawer, Select } from '@/components/ui';
import { cn } from '@/utils/cn';

import { formatDate } from '../administration.meta';
import type { DocumentTemplate, TemplateKind } from '../administration.types';
import { useTemplateMutations, useTemplates } from '../api/useAdministrationQueries';
import { AsyncSection, Overline } from '../components/primitives';
import { SectionShell } from '../components/SectionShell';

/**
 * TemplatesSection — reusable clinical document templates (Phase 17).
 * The six named templates (prescription, certificate, referral, lab and
 * radiology requests, discharge summary) with view, duplicate and
 * archive/restore actions. Duplicate/archive mutate local state and confirm
 * with a toast.
 */
const KIND_LABEL: Record<TemplateKind, string> = {
  prescription: 'Prescription',
  certificate: 'Certificate',
  referral: 'Referral',
  'lab-request': 'Lab request',
  'radiology-request': 'Radiology request',
  discharge: 'Discharge',
};

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
  { value: 'all', label: 'All' },
] as const;

export function TemplatesSection() {
  const query = useTemplates();
  const { toast } = useToast();

  const { create, update } = useTemplateMutations();
  const items = query.data ?? [];
  const [status, setStatus] = useState('active');
  const [preview, setPreview] = useState<DocumentTemplate | null>(null);

  const duplicate = (template: DocumentTemplate) => {
    create.mutate(
      {
        name: template.name + ' (copy)',
        kind: template.kind,
        description: template.description,
        usageCount: 0,
        archived: false,
        updatedAt: new Date().toISOString().slice(0, 10),
      },
      {
        onSuccess: () => toast({ variant: 'success', title: 'Template duplicated' }),
        onError: () => toast({ variant: 'error', title: "Couldn't duplicate " + template.name }),
      },
    );
  };

  const toggleArchive = (template: DocumentTemplate) => {
    update.mutate(
      { id: template.id, changes: { archived: !template.archived } },
      {
        onSuccess: () =>
          toast({ variant: 'info', title: template.archived ? 'Restored' : 'Archived' }),
        onError: () => toast({ variant: 'error', title: "Couldn't update " + template.name }),
      },
    );
  };

  const rows = items.filter((t) => {
    if (status === 'active') return !t.archived;
    if (status === 'archived') return t.archived;
    return true;
  });

  return (
    <SectionShell
      slug="templates"
      toolbar={
        <Select
          options={STATUS_OPTIONS}
          value={status}
          onChange={setStatus}
          aria-label="Filter templates"
          containerClassName="sm:w-44"
        />
      }
    >
      <AsyncSection
        isLoading={query.isLoading}
        isError={query.isError}
        onRetry={() => void query.refetch()}
      >
        {rows.length === 0 ? (
          <p className="rounded-surface border border-dashed border-border px-4 py-10 text-center text-body-sm text-text-secondary">
            No templates to show.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map((template) => (
              <article
                key={template.id}
                className={cn(
                  'flex flex-col gap-3 rounded-surface border border-border bg-surface p-5',
                  template.archived && 'opacity-70',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-surface bg-accent-subtle text-accent">
                    <FileText aria-hidden="true" className="h-5 w-5" strokeWidth={1.75} />
                  </span>
                  <Badge variant="neutral">{KIND_LABEL[template.kind]}</Badge>
                </div>
                <div>
                  <h2 className="text-body font-semibold text-text-primary">{template.name}</h2>
                  <p className="mt-0.5 text-caption text-text-secondary">{template.description}</p>
                </div>
                <div className="flex items-center gap-3 text-caption text-text-tertiary">
                  <span className="tabular-nums">{template.usageCount} uses</span>
                  <span>·</span>
                  <span>Updated {formatDate(template.updatedAt)}</span>
                </div>
                <div className="mt-auto flex flex-wrap gap-2 border-t border-border pt-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    leadingIcon={Eye}
                    onClick={() => setPreview(template)}
                  >
                    View
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    leadingIcon={Copy}
                    onClick={() => duplicate(template)}
                  >
                    Duplicate
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    leadingIcon={template.archived ? ArchiveRestore : Archive}
                    onClick={() => toggleArchive(template)}
                  >
                    {template.archived ? 'Restore' : 'Archive'}
                  </Button>
                </div>
              </article>
            ))}
          </div>
        )}
      </AsyncSection>

      <Drawer
        open={preview !== null}
        onClose={() => setPreview(null)}
        title={preview?.name ?? 'Template'}
        size="lg"
      >
        {preview ? (
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-2">
              {/* Was `ai` — the same KIND_LABEL renders neutral on the card at
                  :105, so one datum wore two colours and one of them was the
                  provenance violet. Matches the card now. */}
              <Badge variant="neutral">{KIND_LABEL[preview.kind]}</Badge>
              <span className="text-caption text-text-tertiary tabular-nums">
                {preview.usageCount} uses
              </span>
              <span className="text-caption text-text-tertiary">
                Updated {formatDate(preview.updatedAt)}
              </span>
            </div>
            <p className="text-body-sm text-text-secondary">{preview.description}</p>
            <div className="rounded-surface border border-dashed border-border bg-surface-sunken p-6">
              <Overline>Preview</Overline>
              <div className="mt-3 flex flex-col gap-2">
                <div className="h-3 w-1/2 rounded-pill bg-border" />
                <div className="h-3 w-full rounded-pill bg-border" />
                <div className="h-3 w-5/6 rounded-pill bg-border" />
                <div className="h-3 w-2/3 rounded-pill bg-border" />
              </div>
              <p className="mt-4 text-caption text-text-secondary">
                Rendered document layout is generated when the template is used from a patient
                record.
              </p>
            </div>
          </div>
        ) : null}
      </Drawer>
    </SectionShell>
  );
}
