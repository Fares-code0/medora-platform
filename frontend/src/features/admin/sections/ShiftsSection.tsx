import { useMemo, useState } from 'react';

import { Plus, Trash2 } from 'lucide-react';

import { useToast } from '@/app/providers';
import { Avatar, Badge, Button, ConfirmationDialog, Select } from '@/components/ui';
import { cn } from '@/utils/cn';

import { SHIFT_EMPHASIS, SHIFT_LABEL, SHIFT_VARIANT, WEEKDAYS } from '../administration.meta';
import type { ShiftAssignment, ShiftKind } from '../administration.types';
import { useShiftMutations, useShifts, useStaff } from '../api/useAdministrationQueries';
import { EntityFormDrawer } from '../components/EntityFormDrawer';
import { AsyncSection, Overline, Panel } from '../components/primitives';
import { SectionShell } from '../components/SectionShell';

/**
 * ShiftsSection — weekly shift planner (Phase 17; editable in Phase B).
 * A staff × weekday grid with a colour per shift type and a type filter.
 * Scrolls horizontally on narrow viewports so the week stays on one row.
 *
 * Each day cell is a button: clicking it toggles that person's assignment
 * for that day. Editing a planner through a form would be the wrong shape —
 * you plan a week by clicking the grid.
 */
const SHIFT_ORDER: readonly ShiftKind[] = ['morning', 'evening', 'on-call', 'vacation', 'leave'];

const KIND_OPTIONS = [
  { value: 'all', label: 'All shift types' },
  ...SHIFT_ORDER.map((kind) => ({ value: kind, label: SHIFT_LABEL[kind] })),
];

type ShiftDraft = Omit<ShiftAssignment, 'id'>;

const KIND_FIELD_OPTIONS = SHIFT_ORDER.map((k) => ({ value: k, label: SHIFT_LABEL[k] }));

export function ShiftsSection() {
  const shifts = useShifts();
  const staff = useStaff();
  const { create, update, remove } = useShiftMutations();
  const { toast } = useToast();
  const [kind, setKind] = useState('all');
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ShiftAssignment | null>(null);

  /** Toggles one weekday for one assignment. */
  const toggleDay = (shift: ShiftAssignment, index: number) => {
    const days = shift.days.map((on, i) => (i === index ? !on : on));
    update.mutate({ id: shift.id, changes: { days } });
  };

  const staffName = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of staff.data ?? []) map.set(member.id, member.name);
    return (id: string) => map.get(id) ?? 'Unknown';
  }, [staff.data]);

  const rows = useMemo(
    () => (shifts.data ?? []).filter((shift) => kind === 'all' || shift.kind === kind),
    [shifts.data, kind],
  );

  return (
    <SectionShell
      slug="shifts"
      actions={
        <Button leadingIcon={Plus} onClick={() => setCreating(true)}>
          Assign shift
        </Button>
      }
      toolbar={
        <Select
          options={KIND_OPTIONS}
          value={kind}
          onChange={setKind}
          aria-label="Filter by shift type"
          containerClassName="sm:w-52"
        />
      }
    >
      <AsyncSection
        isLoading={shifts.isLoading}
        isError={shifts.isError}
        onRetry={() => void shifts.refetch()}
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Overline>Legend</Overline>
            {SHIFT_ORDER.map((k) => (
              <Badge key={k} variant={SHIFT_VARIANT[k]} emphasis={SHIFT_EMPHASIS[k]} dot>
                {SHIFT_LABEL[k]}
              </Badge>
            ))}
          </div>

          <Panel
            title="Weekly planner"
            description="Assignments across the team"
            bodyClassName="p-0"
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-body-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th scope="col" className="px-4 py-3 text-start">
                      <Overline>Team member</Overline>
                    </th>
                    {WEEKDAYS.map((day) => (
                      <th key={day} scope="col" className="px-2 py-3 text-center">
                        <Overline>{day}</Overline>
                      </th>
                    ))}
                    <th scope="col" className="px-2 py-3 text-end">
                      <Overline>Actions</Overline>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((shift) => (
                    <tr key={shift.id} className="border-b border-border last:border-b-0">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <Avatar name={staffName(shift.staffId)} size="xs" decorative />
                          <div className="min-w-0">
                            <div className="truncate font-medium text-text-primary">
                              {staffName(shift.staffId)}
                            </div>
                            <div className="text-caption text-text-tertiary">
                              {SHIFT_LABEL[shift.kind]}
                            </div>
                          </div>
                        </div>
                      </td>
                      {shift.days.map((active, index) => {
                        const dayLabel = WEEKDAYS[index] ?? String(index);
                        return (
                          <td key={shift.id + '-' + dayLabel} className="px-2 py-3 text-center">
                            <button
                              type="button"
                              onClick={() => toggleDay(shift, index)}
                              aria-pressed={active}
                              aria-label={
                                (active ? 'Clear ' : 'Assign ') +
                                dayLabel +
                                ' for ' +
                                staffName(shift.staffId)
                              }
                              className={cn(
                                'mx-auto flex h-8 w-full min-w-16 items-center justify-center rounded-surface',
                                'transition-colors duration-fast hover:bg-surface-sunken',
                              )}
                            >
                              {active ? (
                                <Badge variant={SHIFT_VARIANT[shift.kind]} emphasis={SHIFT_EMPHASIS[shift.kind]}>
                                  {SHIFT_LABEL[shift.kind]}
                                </Badge>
                              ) : (
                                <span
                                  aria-hidden="true"
                                  className={cn('block h-1 w-4 rounded-pill bg-border')}
                                />
                              )}
                            </button>
                          </td>
                        );
                      })}
                      <td className="px-2 py-3 text-end">
                        <Button
                          variant="ghost"
                          size="sm"
                          leadingIcon={Trash2}
                          aria-label={'Remove shift for ' + staffName(shift.staffId)}
                          onClick={() => setPendingDelete(shift)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      </AsyncSection>

      <EntityFormDrawer<ShiftDraft>
        open={creating}
        onClose={() => setCreating(false)}
        title="Assign shift"
        description="Pick the person and shift type, then choose the days."
        submitLabel="Assign shift"
        saving={create.isPending}
        value={{
          staffId: staff.data?.[0]?.id ?? '',
          kind: 'morning',
          days: [false, false, false, false, false, false, false],
        }}
        validate={(draft) => ({
          ...(draft.staffId ? {} : { staffId: 'Choose a team member' }),
          ...(draft.days.some(Boolean) ? {} : { days: 'Select at least one day' }),
        })}
        onSubmit={async (draft) => {
          await create.mutateAsync(draft);
          toast({ variant: 'success', title: 'Shift assigned to ' + staffName(draft.staffId) });
        }}
      >
        {({ draft, patch, errors }) => (
          <>
            <Select
              label="Team member"
              options={(staff.data ?? []).map((member) => ({
                value: member.id,
                label: member.name,
              }))}
              value={draft.staffId}
              onChange={(next) => patch({ staffId: next })}
              error={errors.staffId}
            />
            <Select
              label="Shift type"
              options={KIND_FIELD_OPTIONS}
              value={draft.kind}
              onChange={(next) => patch({ kind: next as ShiftKind })}
            />
            <div className="flex flex-col gap-1.5">
              <Overline>Days</Overline>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAYS.map((day, index) => {
                  const on = draft.days[index] ?? false;
                  return (
                    <button
                      key={day}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        patch({ days: draft.days.map((v, i) => (i === index ? !v : v)) })
                      }
                      className={cn(
                        'rounded-surface border px-3 py-1.5 text-body-sm font-medium transition-colors duration-fast',
                        on
                          ? 'border-primary bg-primary-subtle text-primary'
                          : 'border-border text-text-secondary hover:bg-surface-sunken',
                      )}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>
              {errors.days ? <p className="text-caption text-error">{errors.days}</p> : null}
            </div>
          </>
        )}
      </EntityFormDrawer>

      <ConfirmationDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          const shift = pendingDelete;
          if (!shift) return;
          remove.mutate(shift.id, {
            onSuccess: () => {
              setPendingDelete(null);
              toast({ variant: 'success', title: 'Shift removed' });
            },
            onError: () => toast({ variant: 'error', title: "Couldn't remove the shift" }),
          });
        }}
        title={'Remove this shift for ' + staffName(pendingDelete?.staffId ?? '') + '?'}
        description="Their other assignments are unaffected."
        confirmLabel="Remove shift"
        tone="destructive"
        loading={remove.isPending}
      />
    </SectionShell>
  );
}
