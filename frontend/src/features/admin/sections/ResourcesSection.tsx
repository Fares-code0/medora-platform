import { useMemo, useState } from 'react';

import { Minus, Pencil, Plus, Trash2 } from 'lucide-react';

import { useToast } from '@/app/providers';
import { Grid } from '@/components/layout';
import { Badge, Button, ConfirmationDialog, DataTable, type DataTableColumn, Input, SearchInput, Select } from '@/components/ui';

import { RESOURCE_STATUS_LABEL, RESOURCE_STATUS_VARIANT } from '../administration.meta';
import type { Resource } from '../administration.types';
import { useResourceMutations, useResources } from '../api/useAdministrationQueries';
import { EntityFormDrawer } from '../components/EntityFormDrawer';
import { AsyncSection, GridEmpty } from '../components/primitives';
import { SectionShell, ToolbarGrow } from '../components/SectionShell';

/**
 * ResourcesSection — clinic equipment & consumables (Phase 17; editable in
 * Phase B). A stock table with search, category and status filters, plus
 * add/edit/delete and one-tap quantity adjustment.
 *
 * Stock status is DERIVED from quantity vs reorder level rather than being a
 * field someone has to remember to update — the commonest way a stock board
 * goes stale.
 */
const STATUS_OPTIONS = [
  { value: 'all', label: 'All stock' },
  { value: 'in-stock', label: 'In stock' },
  { value: 'low', label: 'Low' },
  { value: 'out', label: 'Out' },
] as const;

type ResourceDraft = Omit<Resource, 'id' | 'status'>;

/** Stock status follows the numbers; nobody has to keep it in sync by hand. */
function deriveStatus(quantity: number, reorderLevel: number): Resource['status'] {
  if (quantity <= 0) return 'out';
  if (quantity <= reorderLevel) return 'low';
  return 'in-stock';
}

const EMPTY_RESOURCE: ResourceDraft = {
  name: '',
  category: '',
  location: '',
  quantity: 0,
  reorderLevel: 0,
};

export function ResourcesSection() {
  const resources = useResources();
  const { create, update, remove } = useResourceMutations();
  const { toast } = useToast();
  const [editing, setEditing] = useState<Resource | null>(null);
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Resource | null>(null);

  /** Nudges quantity by one and re-derives the stock status with it. */
  const adjust = (res: Resource, delta: 1 | -1) => {
    const quantity = Math.max(0, res.quantity + delta);
    update.mutate({
      id: res.id,
      changes: { quantity, status: deriveStatus(quantity, res.reorderLevel) },
    });
  };
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [status, setStatus] = useState('all');

  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const res of resources.data ?? []) set.add(res.category);
    return [
      { value: 'all', label: 'All categories' },
      ...[...set].map((c) => ({ value: c, label: c })),
    ];
  }, [resources.data]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (resources.data ?? []).filter((res) => {
      if (category !== 'all' && res.category !== category) return false;
      if (status !== 'all' && res.status !== status) return false;
      if (q && !`${res.name} ${res.location}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [resources.data, search, category, status]);

  const columns: readonly DataTableColumn<Resource>[] = [
    {
      id: 'name',
      header: 'Resource',
      cell: (res) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-text-primary">{res.name}</div>
          <div className="truncate text-caption text-text-tertiary">{res.category}</div>
        </div>
      ),
    },
    { id: 'location', header: 'Location', hideBelowMd: true, cell: (res) => res.location },
    {
      id: 'quantity',
      header: 'Qty',
      align: 'right',
      cell: (res) => <span className="tabular-nums text-text-primary">{res.quantity}</span>,
    },
    {
      id: 'reorder',
      header: 'Reorder at',
      align: 'right',
      hideBelowMd: true,
      cell: (res) => <span className="tabular-nums text-text-tertiary">{res.reorderLevel}</span>,
    },
    {
      id: 'status',
      header: 'Status',
      cell: (res) => (
        <Badge variant={RESOURCE_STATUS_VARIANT[res.status]} dot>
          {RESOURCE_STATUS_LABEL[res.status]}
        </Badge>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      align: 'right',
      cell: (res) => (
        <div className="flex items-center justify-end gap-0.5">
          <Button
            variant="ghost"
            size="sm"
            leadingIcon={Minus}
            aria-label={'Decrease ' + res.name}
            disabled={res.quantity <= 0}
            onClick={() => adjust(res, -1)}
          />
          <Button
            variant="ghost"
            size="sm"
            leadingIcon={Plus}
            aria-label={'Increase ' + res.name}
            onClick={() => adjust(res, 1)}
          />
          <Button
            variant="ghost"
            size="sm"
            leadingIcon={Pencil}
            aria-label={'Edit ' + res.name}
            onClick={() => setEditing(res)}
          />
          <Button
            variant="ghost"
            size="sm"
            leadingIcon={Trash2}
            aria-label={'Delete ' + res.name}
            onClick={() => setPendingDelete(res)}
          />
        </div>
      ),
    },
  ];

  return (
    <SectionShell
      slug="resources"
      actions={
        <Button leadingIcon={Plus} onClick={() => setCreating(true)}>
          Add resource
        </Button>
      }
      toolbar={
        <>
          <ToolbarGrow>
            <SearchInput
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onClear={() => setSearch('')}
              placeholder="Search resources…"
              aria-label="Search resources"
            />
          </ToolbarGrow>
          <Select
            options={categoryOptions}
            value={category}
            onChange={setCategory}
            aria-label="Filter by category"
            containerClassName="sm:w-48"
          />
          <Select
            options={STATUS_OPTIONS}
            value={status}
            onChange={setStatus}
            aria-label="Filter by stock status"
            containerClassName="sm:w-40"
          />
        </>
      }
    >
      <AsyncSection
        isLoading={resources.isLoading}
        isError={resources.isError}
        onRetry={() => void resources.refetch()}
      >
        <div className="rounded-surface border border-border bg-surface p-2 sm:p-3">
          <DataTable
            bare
            zebra={false}
            density="admin"
            stickyHeader={false}
            headerVoice="overline"
            columns={columns}
            rows={rows}
            getRowId={(res) => res.id}
            caption="Clinic resources"
            emptyState={<GridEmpty>No resources match these filters.</GridEmpty>}
          />
        </div>
      </AsyncSection>

      <EntityFormDrawer<ResourceDraft>
        open={creating || editing !== null}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        title={editing ? 'Edit ' + editing.name : 'Add resource'}
        submitLabel={editing ? 'Save changes' : 'Add resource'}
        saving={create.isPending || update.isPending}
        value={
          editing
            ? {
                name: editing.name,
                category: editing.category,
                location: editing.location,
                quantity: editing.quantity,
                reorderLevel: editing.reorderLevel,
              }
            : EMPTY_RESOURCE
        }
        validate={(draft) => ({
          ...(draft.name.trim() ? {} : { name: 'Name the resource' }),
          ...(draft.category.trim() ? {} : { category: 'Enter a category' }),
          ...(draft.location.trim() ? {} : { location: 'Where is it kept?' }),
        })}
        onSubmit={async (draft) => {
          const changes = {
            ...draft,
            status: deriveStatus(draft.quantity, draft.reorderLevel),
          };
          if (editing) {
            await update.mutateAsync({ id: editing.id, changes });
            toast({ variant: 'success', title: draft.name + ' updated' });
          } else {
            await create.mutateAsync(changes);
            toast({ variant: 'success', title: draft.name + ' added to stock' });
          }
        }}
      >
        {({ draft, patch, errors }) => (
          <>
            <Input
              label="Resource name"
              required
              value={draft.name}
              onChange={(event) => patch({ name: event.target.value })}
              error={errors.name}
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
                label="Location"
                required
                value={draft.location}
                onChange={(event) => patch({ location: event.target.value })}
                error={errors.location}
              />
            </Grid>
            <Grid columns={{ base: 1, md: 2 }} gap={4}>
              <Input
                label="Quantity in stock"
                type="number"
                min={0}
                value={String(draft.quantity)}
                onChange={(event) => patch({ quantity: Number(event.target.value) || 0 })}
              />
              <Input
                label="Reorder at"
                type="number"
                min={0}
                helperText="Stock status is derived from these two numbers."
                value={String(draft.reorderLevel)}
                onChange={(event) => patch({ reorderLevel: Number(event.target.value) || 0 })}
              />
            </Grid>
          </>
        )}
      </EntityFormDrawer>

      <ConfirmationDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          const res = pendingDelete;
          if (!res) return;
          remove.mutate(res.id, {
            onSuccess: () => {
              setPendingDelete(null);
              toast({ variant: 'success', title: res.name + ' deleted' });
            },
            onError: () => toast({ variant: 'error', title: "Couldn't delete " + res.name }),
          });
        }}
        title={'Delete ' + (pendingDelete?.name ?? 'this resource') + '?'}
        description="It disappears from the stock board and from low-stock counts."
        confirmLabel="Delete resource"
        tone="destructive"
        loading={remove.isPending}
      />
    </SectionShell>
  );
}
