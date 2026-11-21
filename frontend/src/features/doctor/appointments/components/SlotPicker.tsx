import { Alert } from '@/components/feedback';
import { Chip, Input } from '@/components/ui';

import { isValidDateKey, todayKey, type DateKey, type SlotAvailability } from '../model/calendar';

/**
 * The date + availability grid the reschedule and propose-times flows share.
 * Slots holding an active appointment that day are blocked and announced; in
 * the mock a pseudo-busy pattern stands in for availability rules, and over
 * HTTP the server checks working hours when the doctor confirms.
 */
export interface SlotPickerProps {
  dateLabel: string;
  date: DateKey;
  onDateChange: (date: DateKey) => void;
  slots: readonly SlotAvailability[];
  isSelected: (time: string) => boolean;
  onToggle: (time: string) => void;
  /** Mock-only seeded busy slots — see `slotAvailabilityFor`. */
  simulateBusy: boolean;
  /** Disables every slot not already selected — a picker at its limit. */
  full?: boolean;
}

export function SlotPicker({
  dateLabel,
  date,
  onDateChange,
  slots,
  isSelected,
  onToggle,
  simulateBusy,
  full = false,
}: SlotPickerProps) {
  const conflictCount = slots.filter((s) => s.conflict).length;

  return (
    <>
      <Input
        type="date"
        label={dateLabel}
        min={todayKey()}
        value={date}
        onChange={(event) => {
          if (isValidDateKey(event.target.value)) onDateChange(event.target.value);
        }}
      />

      {conflictCount > 0 ? (
        <Alert
          variant="warning"
          title={`${String(conflictCount)} slot${conflictCount === 1 ? ' is' : 's are'} blocked by existing appointments on this day`}
        />
      ) : null}

      <fieldset>
        <legend className="text-body-sm font-medium text-text-primary">Available slots</legend>
        <p className="mt-0.5 text-caption text-text-secondary">
          {simulateBusy
            ? 'Mock availability — unavailable slots are booked or outside working preferences.'
            : 'Slots holding one of your appointments are unavailable. Your working hours are checked when you confirm.'}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {slots.map(({ time, available }) => {
            const selected = isSelected(time);
            return (
              <Chip
                key={time}
                label={time}
                disabled={!available || (full && !selected)}
                selected={selected}
                onSelect={() => onToggle(time)}
              />
            );
          })}
        </div>
      </fieldset>
    </>
  );
}
