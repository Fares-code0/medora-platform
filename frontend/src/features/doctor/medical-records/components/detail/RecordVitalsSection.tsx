import { Fact } from '@/components/patterns';
import { formatDate, formatTime } from '@/utils/dates';

import type { RecordVitalSigns } from '../../model/types';

import { EmptySectionNote, RecordSectionCard } from './RecordSectionCard';

/**
 * Vital signs captured at the visit — absolute values, never color-coded
 * alone. `null` means none were taken, and says so rather than showing zeros.
 */
export function RecordVitalsSection({ vitals }: { vitals: RecordVitalSigns | null }) {
  if (vitals === null) {
    return (
      <RecordSectionCard title="Vital signs">
        <EmptySectionNote>No vital signs recorded for this visit.</EmptySectionNote>
      </RecordSectionCard>
    );
  }
  return (
    <RecordSectionCard
      title="Vital signs"
      caption={`Recorded ${formatDate(vitals.recordedAt)} · ${formatTime(vitals.recordedAt)}`}
    >
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <Fact label="Blood pressure">
          <span className="tabular-nums" dir="ltr">
            {vitals.bloodPressure}
          </span>
        </Fact>
        <Fact label="Heart rate">
          <span className="tabular-nums" dir="ltr">
            {vitals.heartRateBpm} bpm
          </span>
        </Fact>
        <Fact label="Temperature">
          <span className="tabular-nums" dir="ltr">
            {vitals.temperatureC} °C
          </span>
        </Fact>
        <Fact label="Respiratory rate">
          <span className="tabular-nums" dir="ltr">
            {vitals.respiratoryRate} /min
          </span>
        </Fact>
        <Fact label="SpO₂">
          <span className="tabular-nums" dir="ltr">
            {vitals.oxygenSaturation}%
          </span>
        </Fact>
        <Fact label="Weight">
          <span className="tabular-nums" dir="ltr">
            {vitals.weightKg} kg
          </span>
        </Fact>
        <Fact label="Height">
          <span className="tabular-nums" dir="ltr">
            {vitals.heightCm} cm
          </span>
        </Fact>
        <Fact label="BMI">
          <span className="tabular-nums" dir="ltr">
            {vitals.bmi}
          </span>
        </Fact>
      </dl>
    </RecordSectionCard>
  );
}
