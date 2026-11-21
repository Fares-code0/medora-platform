import {
  EllipsisVertical,
  FileDown,
  FilePen,
  FilePlus2,
  Flag,
  FlaskConical,
  Pill,
  Printer,
  Share2,
  UserRound,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { Button, Dropdown, IconButton, Select } from '@/components/ui';
import { useShareLink } from '@/hooks/useShareLink';
import { routes } from '@/routes';
import { MedoraAiLogo } from '@/shared/components/branding';
import { exportPdf, printDataset } from '@/utils/export';

import { recordSummaryDataset } from '../../model/record-export';
import { allowedTransitions, canAmend, canEditRecord } from '../../model/record-lifecycle';
import { RECORD_STATUS_META, type MedicalRecord, type MedicalRecordStatus } from '../../model/types';

/**
 * Record quick actions — View patient navigates to the profile; Ask AI
 * opens the assistant seeded with this record (accent-violet AI
 * signature, DS §7.3); the overflow menu prints/exports the clinical
 * summary through the shared export engine and shares a copyable link.
 *
 * D-21 added the two lifecycle controls. **Add addendum** appears only once
 * something on the record is signed — before that the unsigned note is still
 * the working draft and there is nothing to append to. The **status** select
 * offers only the transitions the map allows from here, so an illegal one is
 * not a disabled option, it is an absent one; the service refuses it a second
 * time regardless.
 */
export function RecordQuickActions({
  record,
  onAmend,
  onEdit,
  onReportIssue,
  onStatusChange,
  statusSubmitting = false,
}: {
  record: MedicalRecord;
  onAmend?: (() => void) | undefined;
  /** Opens the draft edit (DEC-004); offered only while `canEditRecord`. */
  onEdit?: (() => void) | undefined;
  onReportIssue?: (() => void) | undefined;
  onStatusChange?: ((status: MedicalRecordStatus) => void) | undefined;
  statusSubmitting?: boolean;
}) {
  const navigate = useNavigate();
  const shareLink = useShareLink();
  const transitions = allowedTransitions(record);

  return (
    <>
      {canEditRecord(record) && onEdit !== undefined ? (
        <Button variant="secondary" leadingIcon={FilePen} onClick={onEdit}>
          Edit record
        </Button>
      ) : null}
      {canAmend(record) && onAmend !== undefined ? (
        <Button variant="secondary" leadingIcon={FilePlus2} onClick={onAmend}>
          Add addendum
        </Button>
      ) : null}
      {transitions.length > 0 && onStatusChange !== undefined ? (
        <Select
          aria-label="Change record status"
          placeholder={`Status: ${RECORD_STATUS_META[record.status].label}`}
          disabled={statusSubmitting}
          options={transitions.map((status) => ({
            value: status,
            label: `Mark ${RECORD_STATUS_META[status].label.toLowerCase()}`,
          }))}
          value={null}
          onChange={(value) => onStatusChange(value as MedicalRecordStatus)}
          containerClassName="w-48"
        />
      ) : null}
      <Button
        leadingIcon={UserRound}
        onClick={() => navigate(routes.doctor.patient(record.patient.id))}
      >
        View patient
      </Button>
      <Button
        variant="ai"
        leadingIcon={MedoraAiLogo}
        onClick={() =>
          navigate(
            `${routes.doctor.assistant}?context=record&refId=${record.id}&patientId=${record.patient.id}`,
          )
        }
      >
        Ask AI
      </Button>
      <Dropdown
        align="end"
        menuLabel={`More actions for ${record.id}`}
        entries={[
          {
            id: 'lab-results',
            label: 'Lab results',
            icon: FlaskConical,
            onSelect: () => navigate(`${routes.doctor.labs}?patient=${record.patient.id}`),
          },
          {
            id: 'prescriptions',
            label: 'Prescriptions',
            icon: Pill,
            onSelect: () => navigate(`${routes.doctor.pharmacy}?patient=${record.patient.id}`),
          },
          {
            id: 'print',
            label: 'Print record',
            icon: Printer,
            onSelect: () => printDataset(recordSummaryDataset(record)),
          },
          {
            id: 'export-pdf',
            label: 'Export PDF',
            icon: FileDown,
            onSelect: () => exportPdf(recordSummaryDataset(record)),
          },
          {
            id: 'share',
            label: 'Share',
            icon: Share2,
            onSelect: () => void shareLink(routes.doctor.medicalRecord(record.id)),
          },
          ...(onReportIssue === undefined
            ? []
            : ([
                { type: 'separator', id: 'sep-report' },
                {
                  id: 'report-issue',
                  label: 'Report an issue',
                  icon: Flag,
                  onSelect: onReportIssue,
                },
              ] as const)),
        ]}
        trigger={<IconButton icon={EllipsisVertical} aria-label="More record actions" />}
      />
    </>
  );
}
