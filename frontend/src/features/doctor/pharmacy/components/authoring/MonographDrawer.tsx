import { EmptyState, ErrorState, Skeleton } from '@/components/feedback';
import { Stack } from '@/components/layout';
import { Button, Drawer } from '@/components/ui';

import { useMonographQuery } from '../../api/usePrescriptionsQuery';
import type { MedicationMonograph, MedicationSpec } from '../../model/catalogue';

/**
 * A formulary entry's prescribing reference (API §7.2, the monograph half of
 * D-18), read-only. Opened from the medication step for the medication that
 * is selected, so it answers "what am I about to prescribe" in place rather
 * than sending the doctor out of the flow.
 *
 * Each section the source does not record says so in words. A blank
 * "Contraindications" reads as "none", and that is a clinical claim the
 * formulary never made.
 */
export interface MonographDrawerProps {
  medication: MedicationSpec | null;
  onClose: () => void;
}

type SectionKey = keyof Omit<MedicationMonograph, 'medicationId' | 'name' | 'genericName'>;

const SECTIONS: readonly { readonly key: SectionKey; readonly label: string }[] = [
  { key: 'indications', label: 'Indications' },
  { key: 'contraindications', label: 'Contraindications' },
  { key: 'standardDosing', label: 'Standard dosing' },
  { key: 'warnings', label: 'Warnings' },
  { key: 'sideEffects', label: 'Side effects' },
  { key: 'pregnancyCategory', label: 'Pregnancy category' },
];

export function MonographDrawer({ medication, onClose }: MonographDrawerProps) {
  const query = useMonographQuery(medication?.id ?? null);

  return (
    <Drawer
      open={medication !== null}
      onClose={onClose}
      title={medication === null ? 'Monograph' : `${medication.name} — monograph`}
      footer={
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      }
    >
      {medication === null ? null : query.isPending ? (
        <Stack gap={3} aria-busy="true" aria-label="Loading monograph">
          <Skeleton className="h-5 w-1/3" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-5 w-1/3" />
          <Skeleton className="h-16 w-full" />
        </Stack>
      ) : query.isError ? (
        <ErrorState
          title="Couldn't load the monograph"
          error={query.error}
          onRetry={() => void query.refetch()}
          headingLevel="h3"
        />
      ) : query.data === null ? (
        <EmptyState
          title="No monograph on file"
          description={`The formulary holds no prescribing reference for ${medication.name} (${medication.genericName}).`}
          headingLevel="h3"
        />
      ) : (
        <MonographSections monograph={query.data} />
      )}
    </Drawer>
  );
}

function MonographSections({ monograph }: { monograph: MedicationMonograph }) {
  return (
    <Stack gap={4}>
      <p className="text-body-sm text-text-secondary">
        {monograph.name} ({monograph.genericName}) · prescribing reference from the clinic
        formulary.
      </p>
      <dl className="space-y-4">
        {SECTIONS.map(({ key, label }) => {
          const value = monograph[key];
          return (
            <div key={key}>
              <dt className="text-body-sm font-semibold text-text-primary">{label}</dt>
              <dd
                className={
                  value === null
                    ? 'mt-1 text-body-sm italic text-text-secondary'
                    : 'mt-1 whitespace-pre-line text-body-sm text-text-primary'
                }
              >
                {value ?? 'Not recorded in the formulary.'}
              </dd>
            </div>
          );
        })}
      </dl>
    </Stack>
  );
}
