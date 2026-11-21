import { useMemo, useState } from 'react';

import { Pencil, Plus, Trash2, Users } from 'lucide-react';

import { useToast } from '@/app/providers';
import { Grid } from '@/components/layout';
import {
  Avatar,
  Badge,
  Button,
  ConfirmationDialog,
  Input,
  SearchInput,
  Select,
  Textarea,
} from '@/components/ui';

import { ACTIVE_LABEL } from '../administration.meta';
import type { ActiveStatus, Department } from '../administration.types';
import { useDepartmentMutations, useDepartments, useStaff } from '../api/useAdministrationQueries';
import { EntityFormDrawer } from '../components/EntityFormDrawer';
import { AsyncSection, Overline } from '../components/primitives';
import { SectionShell, ToolbarGrow } from '../components/SectionShell';

/**
 * DepartmentsSection — clinic departments (Phase 17; editable in Phase B).
 * A card grid (distinct from the tabular sections) showing each department's
 * head, staffing and active status, with search, a status filter, and full
 * create/edit/delete.
 */
const STATUS_OPTIONS = [
  { value: 'all', label: 'All departments' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
] as const;

type DepartmentDraft = Omit<Department, 'id'>;

const STATUS_FIELD_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];

const EMPTY_DEPARTMENT: DepartmentDraft = {
  name: '',
  description: '',
  status: 'active',
  headStaffId: '',
  staffCount: 0,
};

export function DepartmentsSection() {
  const departments = useDepartments();
  const staff = useStaff();
  const { create, update, remove } = useDepartmentMutations();
  const { toast } = useToast();
  const [editing, setEditing] = useState<Department | null>(null);
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Department | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');

  const headName = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of staff.data ?? []) map.set(member.id, member.name);
    return (id: string) => map.get(id) ?? 'Unassigned';
  }, [staff.data]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (departments.data ?? []).filter((dep) => {
      if (status !== 'all' && dep.status !== status) return false;
      if (q && !`${dep.name} ${dep.description}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [departments.data, search, status]);

  return (
    <SectionShell
      slug="departments"
      actions={
        <Button leadingIcon={Plus} onClick={() => setCreating(true)}>
          Add department
        </Button>
      }
      toolbar={
        <>
          <ToolbarGrow>
            <SearchInput
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onClear={() => setSearch('')}
              placeholder="Search departments…"
              aria-label="Search departments"
            />
          </ToolbarGrow>
          <Select
            options={STATUS_OPTIONS}
            value={status}
            onChange={setStatus}
            aria-label="Filter by status"
            containerClassName="sm:w-48"
          />
        </>
      }
    >
      <AsyncSection
        isLoading={departments.isLoading}
        isError={departments.isError}
        onRetry={() => void departments.refetch()}
      >
        {rows.length === 0 ? (
          <p className="rounded-surface border border-dashed border-border px-4 py-10 text-center text-body-sm text-text-secondary">
            No departments match these filters.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map((dep) => (
              <article
                key={dep.id}
                className="flex flex-col gap-4 rounded-surface border border-border bg-surface p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-body font-semibold text-text-primary">{dep.name}</h2>
                  <Badge variant={dep.status === 'active' ? 'success' : 'neutral'} dot>
                    {ACTIVE_LABEL[dep.status]}
                  </Badge>
                </div>
                <p className="text-body-sm text-text-secondary">{dep.description}</p>
                <div className="mt-auto flex items-center justify-between border-t border-border pt-4">
                  <div className="flex items-center gap-2">
                    <Avatar name={headName(dep.headStaffId)} size="xs" decorative />
                    <div className="flex flex-col">
                      <Overline>Head</Overline>
                      <span className="text-caption font-medium text-text-primary">
                        {headName(dep.headStaffId)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 text-text-tertiary">
                    <Users aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
                    <span className="text-body-sm font-semibold text-text-primary tabular-nums">
                      {dep.staffCount}
                    </span>
                    <span className="text-caption">staff</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      leadingIcon={Pencil}
                      aria-label={'Edit ' + dep.name}
                      onClick={() => setEditing(dep)}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      leadingIcon={Trash2}
                      aria-label={'Delete ' + dep.name}
                      onClick={() => setPendingDelete(dep)}
                    />
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </AsyncSection>

      <EntityFormDrawer<DepartmentDraft>
        open={creating || editing !== null}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        title={editing ? 'Edit ' + editing.name : 'Add department'}
        submitLabel={editing ? 'Save changes' : 'Add department'}
        saving={create.isPending || update.isPending}
        value={
          editing
            ? {
                name: editing.name,
                description: editing.description,
                status: editing.status,
                headStaffId: editing.headStaffId,
                staffCount: editing.staffCount,
              }
            : EMPTY_DEPARTMENT
        }
        validate={(draft) => ({
          ...(draft.name.trim() ? {} : { name: 'Enter a department name' }),
          ...(draft.description.trim() ? {} : { description: 'Describe what it covers' }),
        })}
        onSubmit={async (draft) => {
          if (editing) {
            await update.mutateAsync({ id: editing.id, changes: draft });
            toast({ variant: 'success', title: draft.name + ' updated' });
          } else {
            await create.mutateAsync(draft);
            toast({ variant: 'success', title: draft.name + ' created' });
          }
        }}
      >
        {({ draft, patch, errors }) => (
          <>
            <Input
              label="Department name"
              required
              value={draft.name}
              onChange={(event) => patch({ name: event.target.value })}
              error={errors.name}
            />
            <Textarea
              label="Description"
              required
              rows={3}
              value={draft.description}
              onChange={(event) => patch({ description: event.target.value })}
              error={errors.description}
            />
            <Grid columns={{ base: 1, md: 2 }} gap={4}>
              <Select
                label="Head of department"
                options={[
                  { value: '', label: 'Unassigned' },
                  ...(staff.data ?? []).map((member) => ({
                    value: member.id,
                    label: member.name,
                  })),
                ]}
                value={draft.headStaffId}
                onChange={(next) => patch({ headStaffId: next })}
              />
              <Select
                label="Status"
                options={STATUS_FIELD_OPTIONS}
                value={draft.status}
                onChange={(next) => patch({ status: next as ActiveStatus })}
              />
            </Grid>
            <Input
              label="Staff count"
              type="number"
              min={0}
              value={String(draft.staffCount)}
              onChange={(event) => patch({ staffCount: Number(event.target.value) || 0 })}
            />
          </>
        )}
      </EntityFormDrawer>

      <ConfirmationDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          const dep = pendingDelete;
          if (!dep) return;
          remove.mutate(dep.id, {
            onSuccess: () => {
              setPendingDelete(null);
              toast({ variant: 'success', title: dep.name + ' deleted' });
            },
            onError: () => toast({ variant: 'error', title: "Couldn't delete " + dep.name }),
          });
        }}
        title={'Delete ' + (pendingDelete?.name ?? 'this department') + '?'}
        description="Staff assigned to it keep their records but lose their department."
        confirmLabel="Delete department"
        tone="destructive"
        loading={remove.isPending}
      />
    </SectionShell>
  );
}
