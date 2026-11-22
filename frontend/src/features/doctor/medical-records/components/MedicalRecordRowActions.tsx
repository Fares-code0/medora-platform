import { EllipsisVertical, Eye, FileDown, Printer, Share2, UserRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { useToast } from '@/app/providers';
import { Dropdown, IconButton, Tooltip, type MenuEntry } from '@/components/ui';
import { useShareLink } from '@/hooks/useShareLink';
import { routes } from '@/routes';
import { exportPdf, printDataset } from '@/utils/export';

import { useRecordLoader } from '../api/useMedicalRecordsQuery';
import { recordSummaryDataset } from '../model/record-export';
import type { MedicalRecord, MedicalRecordSummary } from '../model/types';

/**
 * Per-record actions — the inline eye opens the record detail page; the
 * ⋯ menu holds navigation plus real print/export of the clinical summary
 * and a copyable share link.
 *
 * A row is the list's summary, so print and export load the full document
 * first — a printout missing the plan and medications would read as a record
 * that has none.
 */

export interface MedicalRecordRowActionsProps {
  record: MedicalRecordSummary;
  onOpenRecord: (record: MedicalRecordSummary) => void;
}

export function MedicalRecordRowActions({ record, onOpenRecord }: MedicalRecordRowActionsProps) {
  const navigate = useNavigate();
  const shareLink = useShareLink();
  const { toast } = useToast();
  const loadRecord = useRecordLoader();

  const withFullRecord = (act: (full: MedicalRecord) => void) => {
    loadRecord(record.id).then(act, () =>
      toast({
        variant: 'error',
        title: 'Could not load the record',
        description: 'Nothing was printed or exported — try again.',
      }),
    );
  };

  const entries: MenuEntry[] = [
    {
      id: 'view-record',
      label: 'View record',
      icon: Eye,
      onSelect: () => onOpenRecord(record),
    },
    {
      id: 'view-patient',
      label: 'View patient',
      icon: UserRound,
      onSelect: () => navigate(routes.doctor.patient(record.patient.id)),
    },
    { type: 'separator', id: 'sep-documents' },
    {
      id: 'print',
      label: 'Print record',
      icon: Printer,
      onSelect: () => withFullRecord((full) => printDataset(recordSummaryDataset(full))),
    },
    {
      id: 'export-pdf',
      label: 'Export PDF',
      icon: FileDown,
      onSelect: () => withFullRecord((full) => exportPdf(recordSummaryDataset(full))),
    },
    {
      id: 'share',
      label: 'Share',
      icon: Share2,
      onSelect: () => void shareLink(routes.doctor.medicalRecord(record.id)),
    },
  ];

  return (
    <div
      className="flex flex-wrap items-center justify-end gap-1"
      onClick={(event) => event.stopPropagation()}
    >
      <Tooltip content="View record">
        <IconButton
          icon={Eye}
          size="sm"
          aria-label={`View record ${record.id}`}
          onClick={() => onOpenRecord(record)}
        />
      </Tooltip>
      <Dropdown
        align="end"
        menuLabel={`Actions for ${record.id}`}
        entries={entries}
        trigger={
          <IconButton
            icon={EllipsisVertical}
            size="sm"
            aria-label={`More actions for ${record.id}`}
          />
        }
      />
    </div>
  );
}
