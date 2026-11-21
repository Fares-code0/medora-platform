import { useState } from 'react';

import { useToast } from '@/app/providers';
import { Button, Modal, Select, Textarea } from '@/components/ui';
import {
  DATA_ERROR_FIELDS,
  DATA_ERROR_FIELD_LABEL,
  useFileDataErrorReportMutation,
  type DataErrorField,
} from '@/features/shared-domain/data-error-reports';
import type { Patient } from '@/features/shared-domain/patient-identity';

/**
 * "Flag data error → routed to admin" — UX §2.3, D-07.
 *
 * **What this replaces.** The profile's More menu had "Report an issue with
 * this record", and it opened a `mailto:records@medora.health` with the
 * patient's name and MRN in the subject line. Three things wrong with that:
 * nothing was recorded in the app, so no one could tell whether a report had
 * ever been made; nothing reached an administrator, because a mailbox is not
 * a queue and that address is a fixture; and it pushed a patient's name and
 * MRN into whatever mail client the machine happens to have configured,
 * which is PHI leaving the application by the front door.
 *
 * **Where it goes now.** `shared-domain/data-error-reports`, which the admin
 * patients area folds into each account's support flags as a
 * `data-correction` — a `SupportFlagKind` that has always existed with
 * nothing producing it. That puts the report in `openWorkCount`, and through
 * it into the ADM-01 action queue's "Accounts with open issues" row and its
 * `/admin/patients?flag=open` destination. No new admin screen: the queue
 * D-07 was waiting for has been there since Phase C.
 *
 * **The description is required.** "The record is wrong" with no detail is a
 * ticket that gets closed unread, which is the same nothing as the mailto.
 * The store refuses an empty one too, so the rule is not only in this form.
 */
export function ReportDataErrorDialog({
  patient,
  reportedBy,
  open,
  onClose,
}: {
  patient: Patient;
  reportedBy: string;
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [field, setField] = useState<DataErrorField>('name');
  const [description, setDescription] = useState('');
  const [touched, setTouched] = useState(false);
  const mutation = useFileDataErrorReportMutation();

  const trimmed = description.trim();
  const invalid = trimmed.length === 0;

  const close = () => {
    setField('name');
    setDescription('');
    setTouched(false);
    onClose();
  };

  const submit = () => {
    setTouched(true);
    if (invalid) return;

    mutation.mutate(
      {
        patientId: patient.id,
        patientName: patient.name,
        patientMrn: patient.mrn,
        field,
        description: trimmed,
        reportedBy,
      },
      {
        onSuccess: (report) => {
          // Names the reference and where it went. A bare "Reported" would
          // be the success toast D-16 was filed for — true only if the
          // write landed, and unfalsifiable to the doctor either way.
          toast({
            variant: 'success',
            title: `Reported as ${report.id}`,
            description:
              'It is now on this patient’s account in the administrators’ queue as a data correction.',
          });
          close();
        },
        onError: () => {
          toast({
            variant: 'error',
            title: 'The report was not filed',
            description: 'Nothing was sent to the administrators. Try again.',
          });
        },
      },
    );
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Flag a data error"
      description={`Reports a correction on ${patient.name} (MRN ${patient.mrn}) to the administrators. It does not change the record.`}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={mutation.isPending}>
            Send to administrators
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Select
          label="What is wrong"
          value={field}
          onChange={(value) => setField(value as DataErrorField)}
          options={DATA_ERROR_FIELDS.map((id) => ({
            value: id,
            label: DATA_ERROR_FIELD_LABEL[id],
          }))}
        />
        <Textarea
          label="What should it say"
          required
          rows={4}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          onBlur={() => setTouched(true)}
          placeholder="e.g. Date of birth is 1962-03-14 per the patient's ID, not 1963-03-14."
          error={touched && invalid ? 'Describe the correction so it can be acted on.' : undefined}
          helperText="Goes to the administrators verbatim."
        />
      </div>
    </Modal>
  );
}
