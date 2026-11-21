import { useMemo, useState } from 'react';

import { CalendarOff, Pencil, Plus, Repeat, Trash2 } from 'lucide-react';

import { useToast } from '@/app/providers';
import { Grid } from '@/components/layout';
import {
  Badge,
  Button,
  ConfirmationDialog,
  Input,
  SearchInput,
  Select,
  Switch,
} from '@/components/ui';

import { formatDate } from '../administration.meta';
import type { Holiday } from '../administration.types';
import { useHolidayMutations, useHolidays } from '../api/useAdministrationQueries';
import { EntityFormDrawer } from '../components/EntityFormDrawer';
import { AsyncSection, Overline } from '../components/primitives';
import { SectionShell, ToolbarGrow } from '../components/SectionShell';

/**
 * HolidaysSection — clinic and public closures (Phase 17; editable in
 * Phase B). A chronological list with a type filter and search, plus
 * create/edit/delete for the closure calendar.
 */
const KIND_OPTIONS = [
  { value: 'all', label: 'All holidays' },
  { value: 'public', label: 'Public' },
  { value: 'clinic', label: 'Clinic' },
] as const;

type HolidayDraft = Omit<Holiday, 'id'>;

const KIND_FIELD_OPTIONS = [
  { value: 'public', label: 'Public holiday' },
  { value: 'clinic', label: 'Clinic closure' },
];

const EMPTY_HOLIDAY: HolidayDraft = {
  name: '',
  date: new Date().toISOString().slice(0, 10),
  kind: 'clinic',
  recurring: false,
};

export function HolidaysSection() {
  const holidays = useHolidays();
  const { create, update, remove } = useHolidayMutations();
  const { toast } = useToast();
  const [editing, setEditing] = useState<Holiday | null>(null);
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Holiday | null>(null);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('all');

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (holidays.data ?? [])
      .filter((holiday) => {
        if (kind !== 'all' && holiday.kind !== kind) return false;
        if (q && !holiday.name.toLowerCase().includes(q)) return false;
        return true;
      })
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [holidays.data, search, kind]);

  return (
    <SectionShell
      slug="holidays"
      actions={
        <Button leadingIcon={Plus} onClick={() => setCreating(true)}>
          Add holiday
        </Button>
      }
      toolbar={
        <>
          <ToolbarGrow>
            <SearchInput
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onClear={() => setSearch('')}
              placeholder="Search holidays…"
              aria-label="Search holidays"
            />
          </ToolbarGrow>
          <Select
            options={KIND_OPTIONS}
            value={kind}
            onChange={setKind}
            aria-label="Filter by holiday type"
            containerClassName="sm:w-44"
          />
        </>
      }
    >
      <AsyncSection
        isLoading={holidays.isLoading}
        isError={holidays.isError}
        onRetry={() => void holidays.refetch()}
      >
        {rows.length === 0 ? (
          <p className="rounded-surface border border-dashed border-border px-4 py-10 text-center text-body-sm text-text-secondary">
            No holidays match these filters.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((holiday) => (
              <li
                key={holiday.id}
                className="flex items-center gap-4 rounded-surface border border-border bg-surface p-4"
              >
                <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-surface bg-primary-subtle text-primary">
                  <CalendarOff aria-hidden="true" className="h-5 w-5" strokeWidth={1.75} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-body-sm font-semibold text-text-primary">
                    {holiday.name}
                  </div>
                  <div className="flex items-center gap-2 text-caption text-text-tertiary">
                    <Overline>{formatDate(holiday.date)}</Overline>
                    {holiday.recurring ? (
                      <span className="inline-flex items-center gap-1">
                        <Repeat aria-hidden="true" className="h-3 w-3" strokeWidth={1.75} />
                        recurring
                      </span>
                    ) : null}
                  </div>
                </div>
                {/* `ai` is provenance, never a sixth decorative hue (ADR-0001 §6):
                    a clinic holiday is not AI-generated. Neutral keeps the two
                    kinds separable without spending the provenance signal. */}
                <Badge variant={holiday.kind === 'public' ? 'info' : 'neutral'}>
                  {holiday.kind === 'public' ? 'Public' : 'Clinic'}
                </Badge>
                <div className="flex items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    leadingIcon={Pencil}
                    aria-label={'Edit ' + holiday.name}
                    onClick={() => setEditing(holiday)}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    leadingIcon={Trash2}
                    aria-label={'Delete ' + holiday.name}
                    onClick={() => setPendingDelete(holiday)}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </AsyncSection>

      <EntityFormDrawer<HolidayDraft>
        open={creating || editing !== null}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        title={editing ? 'Edit ' + editing.name : 'Add holiday'}
        submitLabel={editing ? 'Save changes' : 'Add holiday'}
        saving={create.isPending || update.isPending}
        value={
          editing
            ? {
                name: editing.name,
                date: editing.date,
                kind: editing.kind,
                recurring: editing.recurring,
              }
            : EMPTY_HOLIDAY
        }
        validate={(draft) => ({
          ...(draft.name.trim() ? {} : { name: 'Name the closure' }),
          ...(/^\d{4}-\d{2}-\d{2}$/.test(draft.date) ? {} : { date: 'Pick a date' }),
        })}
        onSubmit={async (draft) => {
          if (editing) {
            await update.mutateAsync({ id: editing.id, changes: draft });
            toast({ variant: 'success', title: draft.name + ' updated' });
          } else {
            await create.mutateAsync(draft);
            toast({ variant: 'success', title: draft.name + ' added to the calendar' });
          }
        }}
      >
        {({ draft, patch, errors }) => (
          <>
            <Input
              label="Name"
              required
              value={draft.name}
              onChange={(event) => patch({ name: event.target.value })}
              error={errors.name}
            />
            <Grid columns={{ base: 1, md: 2 }} gap={4}>
              <Input
                label="Date"
                type="date"
                required
                value={draft.date}
                onChange={(event) => patch({ date: event.target.value })}
                error={errors.date}
              />
              <Select
                label="Type"
                options={KIND_FIELD_OPTIONS}
                value={draft.kind}
                onChange={(next) => patch({ kind: next as Holiday['kind'] })}
              />
            </Grid>
            <Switch
              label="Repeats every year"
              checked={draft.recurring}
              onCheckedChange={(checked) => patch({ recurring: checked })}
            />
          </>
        )}
      </EntityFormDrawer>

      <ConfirmationDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          const holiday = pendingDelete;
          if (!holiday) return;
          remove.mutate(holiday.id, {
            onSuccess: () => {
              setPendingDelete(null);
              toast({ variant: 'success', title: holiday.name + ' removed' });
            },
            onError: () => toast({ variant: 'error', title: "Couldn't remove " + holiday.name }),
          });
        }}
        title={'Delete ' + (pendingDelete?.name ?? 'this holiday') + '?'}
        description="The clinic will be treated as open on that date."
        confirmLabel="Delete holiday"
        tone="destructive"
        loading={remove.isPending}
      />
    </SectionShell>
  );
}
