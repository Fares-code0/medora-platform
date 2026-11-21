import { useMemo, useState } from 'react';

import { FileCheck2, Pencil, Plus, ScrollText, Trash2 } from 'lucide-react';

import { useToast } from '@/app/providers';
import { Grid } from '@/components/layout';
import {
  Badge,
  Button,
  ConfirmationDialog,
  Drawer,
  Input,
  SearchInput,
  Select,
  Textarea,
} from '@/components/ui';

import { formatDate } from '../administration.meta';
import type { Policy } from '../administration.types';
import { usePolicies, usePolicyMutations } from '../api/useAdministrationQueries';
import { EntityFormDrawer } from '../components/EntityFormDrawer';
import { AsyncSection, Overline } from '../components/primitives';
import { SectionShell, ToolbarGrow } from '../components/SectionShell';

/**
 * PoliciesSection — clinic operating policies (Phase 17; editable in
 * Phase B). Searchable, category-filterable list; selecting a policy opens a
 * viewer, and policies can now be published, revised and retired.
 *
 * The last-updated date is stamped on save rather than typed — a policy
 * register whose dates are hand-entered stops being trustworthy.
 */
type PolicyDraft = Omit<Policy, 'id' | 'updatedAt'>;

const EMPTY_POLICY: PolicyDraft = { title: '', category: '', summary: '', version: 'v1.0' };

/** Stamped on save so the register's dates are always real. */
function TODAY_ISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function PoliciesSection() {
  const policies = usePolicies();
  const { create, update, remove } = usePolicyMutations();
  const { toast } = useToast();
  const [editing, setEditing] = useState<Policy | null>(null);
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Policy | null>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [selected, setSelected] = useState<Policy | null>(null);

  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const policy of policies.data ?? []) set.add(policy.category);
    return [
      { value: 'all', label: 'All categories' },
      ...[...set].map((c) => ({ value: c, label: c })),
    ];
  }, [policies.data]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (policies.data ?? []).filter((policy) => {
      if (category !== 'all' && policy.category !== category) return false;
      if (q && !`${policy.title} ${policy.summary}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [policies.data, search, category]);

  return (
    <SectionShell
      slug="policies"
      actions={
        <Button leadingIcon={Plus} onClick={() => setCreating(true)}>
          Publish policy
        </Button>
      }
      toolbar={
        <>
          <ToolbarGrow>
            <SearchInput
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onClear={() => setSearch('')}
              placeholder="Search policies…"
              aria-label="Search policies"
            />
          </ToolbarGrow>
          <Select
            options={categoryOptions}
            value={category}
            onChange={setCategory}
            aria-label="Filter by category"
            containerClassName="sm:w-48"
          />
        </>
      }
    >
      <AsyncSection
        isLoading={policies.isLoading}
        isError={policies.isError}
        onRetry={() => void policies.refetch()}
      >
        {rows.length === 0 ? (
          <p className="rounded-surface border border-dashed border-border px-4 py-10 text-center text-body-sm text-text-secondary">
            No policies match these filters.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map((policy) => (
              <li
                key={policy.id}
                className="flex items-center gap-4 rounded-surface border border-border bg-surface p-4"
              >
                <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-surface bg-primary-subtle text-primary">
                  <ScrollText aria-hidden="true" className="h-5 w-5" strokeWidth={1.75} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-body-sm font-semibold text-text-primary">
                      {policy.title}
                    </span>
                    <Badge variant="neutral">{policy.version}</Badge>
                  </div>
                  <div className="truncate text-caption text-text-secondary">{policy.summary}</div>
                  <div className="mt-1 flex items-center gap-2">
                    <Overline>{policy.category}</Overline>
                    <span className="text-caption text-text-tertiary">
                      Updated {formatDate(policy.updatedAt)}
                    </span>
                  </div>
                </div>
                <Button variant="secondary" size="sm" onClick={() => setSelected(policy)}>
                  View
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  leadingIcon={Pencil}
                  aria-label={'Edit ' + policy.title}
                  onClick={() => setEditing(policy)}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  leadingIcon={Trash2}
                  aria-label={'Retire ' + policy.title}
                  onClick={() => setPendingDelete(policy)}
                />
              </li>
            ))}
          </ul>
        )}
      </AsyncSection>

      <EntityFormDrawer<PolicyDraft>
        open={creating || editing !== null}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        title={editing ? 'Revise ' + editing.title : 'Publish policy'}
        submitLabel={editing ? 'Save revision' : 'Publish'}
        saving={create.isPending || update.isPending}
        value={
          editing
            ? {
                title: editing.title,
                category: editing.category,
                summary: editing.summary,
                version: editing.version,
              }
            : EMPTY_POLICY
        }
        validate={(draft) => ({
          ...(draft.title.trim() ? {} : { title: 'Name the policy' }),
          ...(draft.category.trim() ? {} : { category: 'Enter a category' }),
          ...(draft.summary.trim() ? {} : { summary: 'Summarise the policy' }),
          ...(draft.version.trim() ? {} : { version: 'Enter a version' }),
        })}
        onSubmit={async (draft) => {
          const changes = { ...draft, updatedAt: TODAY_ISO() };
          if (editing) {
            await update.mutateAsync({ id: editing.id, changes });
            toast({ variant: 'success', title: draft.title + ' revised' });
          } else {
            await create.mutateAsync(changes);
            toast({ variant: 'success', title: draft.title + ' published' });
          }
        }}
      >
        {({ draft, patch, errors }) => (
          <>
            <Input
              label="Policy title"
              required
              value={draft.title}
              onChange={(event) => patch({ title: event.target.value })}
              error={errors.title}
            />
            <Grid columns={{ base: 1, md: 2 }} gap={4}>
              <Input
                label="Category"
                required
                value={draft.category}
                onChange={(event) => patch({ category: event.target.value })}
                error={errors.category}
              />
              <Input
                label="Version"
                required
                helperText="Last-updated is stamped automatically on save."
                value={draft.version}
                onChange={(event) => patch({ version: event.target.value })}
                error={errors.version}
              />
            </Grid>
            <Textarea
              label="Summary"
              required
              rows={4}
              value={draft.summary}
              onChange={(event) => patch({ summary: event.target.value })}
              error={errors.summary}
            />
          </>
        )}
      </EntityFormDrawer>

      <ConfirmationDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          const policy = pendingDelete;
          if (!policy) return;
          remove.mutate(policy.id, {
            onSuccess: () => {
              setPendingDelete(null);
              setSelected(null);
              toast({ variant: 'success', title: policy.title + ' retired' });
            },
            onError: () => toast({ variant: 'error', title: "Couldn't retire " + policy.title }),
          });
        }}
        title={'Retire ' + (pendingDelete?.title ?? 'this policy') + '?'}
        description="It is removed from the register. Staff will no longer see it as current."
        confirmLabel="Retire policy"
        tone="destructive"
        loading={remove.isPending}
      />

      <Drawer
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected?.title ?? 'Policy'}
        size="lg"
      >
        {selected ? (
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="info">{selected.category}</Badge>
              <Badge variant="neutral">{selected.version}</Badge>
              <span className="text-caption text-text-tertiary">
                Last updated {formatDate(selected.updatedAt)}
              </span>
            </div>
            <div className="flex flex-col gap-2">
              <Overline>Summary</Overline>
              <p className="text-body-sm text-text-secondary">{selected.summary}</p>
            </div>
            <div className="flex items-start gap-3 rounded-surface border border-border bg-surface-sunken p-4">
              <FileCheck2
                aria-hidden="true"
                className="mt-0.5 h-5 w-5 shrink-0 text-success"
                strokeWidth={1.75}
              />
              <p className="text-body-sm text-text-secondary">
                This is the current approved version. The full policy document opens in the clinic
                document store; this viewer shows the controlled summary and metadata.
              </p>
            </div>
          </div>
        ) : null}
      </Drawer>
    </SectionShell>
  );
}
