import { useMemo, useState } from 'react';

import { Lock, Mail, Pencil, Phone, Plus, Trash2 } from 'lucide-react';

import { useToast } from '@/app/providers';
import { Grid } from '@/components/layout';
import { StatusBadge } from '@/components/patterns';
import {
  Avatar,
  Button,
  ConfirmationDialog,
  DataTable,
  type DataTableColumn,
  Drawer,
  Input,
  SearchInput,
  Select,
} from '@/components/ui';
import { cn } from '@/utils/cn';

import { PRESENCE_KIND, PRESENCE_LABEL, STAFF_ROLE_LABEL } from '../administration.meta';
import type { PresenceStatus, StaffMember, StaffRole } from '../administration.types';
import { useDepartments, useStaff, useStaffMutations } from '../api/useAdministrationQueries';
import { EntityFormDrawer } from '../components/EntityFormDrawer';
import { AsyncSection, GridEmpty, Overline } from '../components/primitives';
import { SectionShell, ToolbarGrow } from '../components/SectionShell';

/**
 * StaffSection — clinic staff roster (Phase 17; made editable in Phase B).
 * Search + role/department/status filters over the team, a details drawer
 * with contact info and permissions, and full CRUD: add a member, edit one,
 * change presence inline, or remove one behind a confirmation.
 *
 * Until Phase B this page was read-only — it advertised "roles, availability
 * and permissions" and offered no way to change any of them.
 */
const ROLE_OPTIONS = [
  { value: 'all', label: 'All roles' },
  { value: 'doctor', label: 'Doctors' },
  { value: 'nurse', label: 'Nurses' },
  { value: 'receptionist', label: 'Receptionists' },
  { value: 'laboratory', label: 'Laboratory' },
  { value: 'pharmacy', label: 'Pharmacy' },
] as const;

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'on-duty', label: 'On duty' },
  { value: 'on-break', label: 'On break' },
  { value: 'off-duty', label: 'Off duty' },
  { value: 'on-leave', label: 'On leave' },
] as const;

/** The editable subset of a staff member; `id` is assigned by the store. */
type StaffDraft = Omit<StaffMember, 'id' | 'permissions' | 'avatarUrl'>;

const ROLE_FIELD_OPTIONS = ROLE_OPTIONS.filter((option) => option.value !== 'all').map(
  (option) => ({
    value: option.value,
    label: option.label,
  }),
);

const STATUS_FIELD_OPTIONS = STATUS_OPTIONS.filter((option) => option.value !== 'all').map(
  (option) => ({ value: option.value, label: option.label }),
);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function emptyDraft(departmentId: string): StaffDraft {
  return {
    name: '',
    role: 'nurse',
    title: '',
    departmentId,
    status: 'on-duty',
    phone: '',
    email: '',
    workingHours: '09:00 – 17:00',
  };
}

function toDraft(member: StaffMember): StaffDraft {
  return {
    name: member.name,
    role: member.role,
    title: member.title,
    departmentId: member.departmentId,
    status: member.status,
    phone: member.phone,
    email: member.email,
    workingHours: member.workingHours,
  };
}

export function StaffSection() {
  const staff = useStaff();
  const departments = useDepartments();

  const [search, setSearch] = useState('');
  const [role, setRole] = useState('all');
  const [status, setStatus] = useState('all');
  const [department, setDepartment] = useState('all');
  const [selected, setSelected] = useState<StaffMember | null>(null);
  const [editing, setEditing] = useState<StaffMember | null>(null);
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<StaffMember | null>(null);

  const { create, update, remove } = useStaffMutations();
  const { toast } = useToast();

  const firstDepartmentId = departments.data?.[0]?.id ?? '';
  const formOpen = creating || editing !== null;

  const departmentName = useMemo(() => {
    const map = new Map<string, string>();
    for (const dep of departments.data ?? []) map.set(dep.id, dep.name);
    return (id: string) => map.get(id) ?? '—';
  }, [departments.data]);

  const departmentOptions = useMemo(
    () => [
      { value: 'all', label: 'All departments' },
      ...(departments.data ?? []).map((dep) => ({ value: dep.id, label: dep.name })),
    ],
    [departments.data],
  );

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (staff.data ?? []).filter((member) => {
      if (role !== 'all' && member.role !== role) return false;
      if (status !== 'all' && member.status !== status) return false;
      if (department !== 'all' && member.departmentId !== department) return false;
      if (q && !`${member.name} ${member.email} ${member.title}`.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [staff.data, search, role, status, department]);

  const columns: readonly DataTableColumn<StaffMember>[] = [
    {
      id: 'name',
      header: 'Member',
      cell: (member) => (
        <div className="flex items-center gap-3">
          <Avatar
            name={member.name}
            size="sm"
            roleRing={member.role === 'doctor' ? 'doctor' : 'staff'}
            decorative
          />
          <div className="min-w-0">
            <div className="truncate font-medium text-text-primary">{member.name}</div>
            <div className="truncate text-caption text-text-secondary">{member.title}</div>
          </div>
        </div>
      ),
    },
    { id: 'role', header: 'Role', cell: (member) => STAFF_ROLE_LABEL[member.role] },
    {
      id: 'department',
      header: 'Department',
      hideBelowMd: true,
      cell: (member) => departmentName(member.departmentId),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (member) => (
        <StatusBadge status={PRESENCE_KIND[member.status]} label={PRESENCE_LABEL[member.status]} />
      ),
    },
    {
      id: 'contact',
      header: 'Phone',
      hideBelowMd: true,
      cell: (member) => (
        <span className="tabular-nums text-text-tertiary" dir="ltr">
          {member.phone}
        </span>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      align: 'right',
      cell: (member) => (
        /*
         * The row opens the detail panel, so every control in this cell has
         * to stop its click before the row sees it — otherwise editing a
         * member also selects them, and changing presence opens a panel over
         * the dropdown that set it. This was already true under `DataGrid`,
         * whose rows carried the same click handler; the migration is what
         * made it worth auditing rather than what introduced it.
         *
         * Keyboard needs no separate guard: `DataTable` ignores key events
         * whose target is not the row itself, and the click these controls
         * synthesise is stopped here.
         */
        <div
          className="flex items-center justify-end gap-1"
          onClick={(event) => event.stopPropagation()}
        >
          {/* Presence is the most-changed field, so it is editable inline
              rather than only inside the edit form. */}
          <Select
            options={STATUS_FIELD_OPTIONS}
            value={member.status}
            onChange={(next) => {
              update.mutate(
                { id: member.id, changes: { status: next as PresenceStatus } },
                {
                  onSuccess: () =>
                    toast({
                      variant: 'success',
                      title:
                        member.name +
                        ' is now ' +
                        PRESENCE_LABEL[next as PresenceStatus].toLowerCase(),
                    }),
                  onError: () =>
                    toast({ variant: 'error', title: "Couldn't update " + member.name }),
                },
              );
            }}
            aria-label={'Change presence for ' + member.name}
            containerClassName="w-32"
          />
          <Button
            variant="ghost"
            size="sm"
            leadingIcon={Pencil}
            aria-label={'Edit ' + member.name}
            onClick={() => setEditing(member)}
          />
          <Button
            variant="ghost"
            size="sm"
            leadingIcon={Trash2}
            aria-label={'Remove ' + member.name}
            onClick={() => setPendingDelete(member)}
          />
        </div>
      ),
    },
  ];

  return (
    <SectionShell
      slug="staff"
      actions={
        <Button leadingIcon={Plus} onClick={() => setCreating(true)}>
          Add staff member
        </Button>
      }
      toolbar={
        <>
          <ToolbarGrow>
            <SearchInput
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onClear={() => setSearch('')}
              placeholder="Search staff by name or email…"
              aria-label="Search staff"
            />
          </ToolbarGrow>
          <Select
            options={ROLE_OPTIONS}
            value={role}
            onChange={setRole}
            aria-label="Filter by role"
            containerClassName="sm:w-44"
          />
          <Select
            options={departmentOptions}
            value={department}
            onChange={setDepartment}
            aria-label="Filter by department"
            containerClassName="sm:w-48"
          />
          <Select
            options={STATUS_OPTIONS}
            value={status}
            onChange={setStatus}
            aria-label="Filter by status"
            containerClassName="sm:w-40"
          />
        </>
      }
    >
      <AsyncSection
        isLoading={staff.isLoading}
        isError={staff.isError}
        onRetry={() => void staff.refetch()}
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
            getRowId={(member) => member.id}
            onRowClick={setSelected}
            caption="Clinic staff"
            emptyState={<GridEmpty>No staff match these filters.</GridEmpty>}
          />
        </div>
      </AsyncSection>

      <Drawer
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected?.name ?? 'Staff member'}
        size="md"
      >
        {selected ? (
          <StaffDetails member={selected} departmentName={departmentName(selected.departmentId)} />
        ) : null}
      </Drawer>

      <EntityFormDrawer<StaffDraft>
        open={formOpen}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        title={editing ? 'Edit ' + editing.name : 'Add staff member'}
        submitLabel={editing ? 'Save changes' : 'Add member'}
        value={editing ? toDraft(editing) : emptyDraft(firstDepartmentId)}
        saving={create.isPending || update.isPending}
        validate={(draft) => ({
          ...(draft.name.trim() ? {} : { name: 'Enter a name' }),
          ...(draft.title.trim() ? {} : { title: 'Enter a job title' }),
          ...(EMAIL_RE.test(draft.email) ? {} : { email: 'Enter a valid email' }),
          ...(draft.phone.trim() ? {} : { phone: 'Enter a phone number' }),
          ...(draft.departmentId ? {} : { departmentId: 'Choose a department' }),
        })}
        onSubmit={async (draft) => {
          if (editing) {
            await update.mutateAsync({ id: editing.id, changes: draft });
            toast({ variant: 'success', title: draft.name + ' updated' });
          } else {
            await create.mutateAsync({ ...draft, permissions: [] });
            toast({ variant: 'success', title: draft.name + ' added to the team' });
          }
        }}
      >
        {({ draft, patch, errors }) => (
          <>
            <Grid columns={{ base: 1, md: 2 }} gap={4}>
              <Input
                label="Full name"
                required
                value={draft.name}
                onChange={(event) => patch({ name: event.target.value })}
                error={errors.name}
              />
              <Input
                label="Job title"
                required
                value={draft.title}
                onChange={(event) => patch({ title: event.target.value })}
                error={errors.title}
              />
            </Grid>

            <Grid columns={{ base: 1, md: 2 }} gap={4}>
              <Select
                label="Role"
                options={ROLE_FIELD_OPTIONS}
                value={draft.role}
                onChange={(next) => patch({ role: next as StaffRole })}
              />
              <Select
                label="Department"
                options={(departments.data ?? []).map((dep) => ({
                  value: dep.id,
                  label: dep.name,
                }))}
                value={draft.departmentId}
                onChange={(next) => patch({ departmentId: next })}
                error={errors.departmentId}
              />
            </Grid>

            <Grid columns={{ base: 1, md: 2 }} gap={4}>
              <Input
                label="Email"
                type="email"
                required
                value={draft.email}
                onChange={(event) => patch({ email: event.target.value })}
                error={errors.email}
              />
              <Input
                label="Phone"
                required
                value={draft.phone}
                onChange={(event) => patch({ phone: event.target.value })}
                error={errors.phone}
              />
            </Grid>

            <Grid columns={{ base: 1, md: 2 }} gap={4}>
              <Select
                label="Presence"
                options={STATUS_FIELD_OPTIONS}
                value={draft.status}
                onChange={(next) => patch({ status: next as PresenceStatus })}
              />
              <Input
                label="Working hours"
                value={draft.workingHours}
                onChange={(event) => patch({ workingHours: event.target.value })}
              />
            </Grid>
          </>
        )}
      </EntityFormDrawer>

      <ConfirmationDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          const member = pendingDelete;
          if (!member) return;
          remove.mutate(member.id, {
            onSuccess: () => {
              setPendingDelete(null);
              setSelected(null);
              toast({ variant: 'success', title: member.name + ' removed from the roster' });
            },
            onError: () => toast({ variant: 'error', title: "Couldn't remove " + member.name }),
          });
        }}
        title={'Remove ' + (pendingDelete?.name ?? 'this member') + '?'}
        description="They lose access to the clinic workspace. Shift and queue history is kept."
        confirmLabel="Remove member"
        tone="destructive"
        loading={remove.isPending}
      />
    </SectionShell>
  );
}

function StaffDetails({ member, departmentName }: { member: StaffMember; departmentName: string }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <Avatar
          name={member.name}
          size="lg"
          roleRing={member.role === 'doctor' ? 'doctor' : 'staff'}
          decorative
        />
        <div className="min-w-0">
          <div className="text-h5 font-semibold text-text-primary">{member.name}</div>
          <div className="text-body-sm text-text-secondary">{member.title}</div>
          <div className="mt-1.5">
            <StatusBadge
              status={PRESENCE_KIND[member.status]}
              label={PRESENCE_LABEL[member.status]}
            />
          </div>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-4">
        <DetailField label="Role" value={STAFF_ROLE_LABEL[member.role]} />
        <DetailField label="Department" value={departmentName} />
        <DetailField label="Working hours" value={member.workingHours} />
        <DetailField label="Status" value={PRESENCE_LABEL[member.status]} />
      </dl>

      <div className="flex flex-col gap-2">
        <Overline>Contact</Overline>
        <a
          href={`tel:${member.phone}`}
          className="flex items-center gap-2 text-body-sm text-text-secondary hover:text-primary"
        >
          <Phone aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
          <span className="tabular-nums" dir="ltr">
            {member.phone}
          </span>
        </a>
        <a
          href={`mailto:${member.email}`}
          className="flex items-center gap-2 text-body-sm text-text-secondary hover:text-primary"
        >
          <Mail aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
          <span className="truncate">{member.email}</span>
        </a>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1.5">
          <Lock aria-hidden="true" className="h-3.5 w-3.5 text-text-tertiary" strokeWidth={1.75} />
          <Overline>Permissions · read only</Overline>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {member.permissions.map((permission) => (
            <span
              key={permission}
              className={cn(
                'inline-flex items-center rounded-surface bg-surface-sunken px-2 py-1',
                'text-caption font-medium text-text-secondary',
              )}
            >
              {permission}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <Overline>{label}</Overline>
      <span className="text-body-sm text-text-primary">{value}</span>
    </div>
  );
}
