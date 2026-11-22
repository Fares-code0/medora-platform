import {
  Ban,
  EllipsisVertical,
  Eye,
  FileDown,
  FlaskConical,
  FolderHeart,
  Printer,
  RotateCcw,
  UserRound,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { Dropdown, IconButton, Tooltip, type MenuEntry } from '@/components/ui';
import { routes } from '@/routes';
import { MedoraAiLogo } from '@/shared/components/branding';
import { exportPdf, printDataset } from '@/utils/export';

import { prescriptionDataset } from '../model/prescription-export';
import { isRenewable } from '../model/selectors';
import type { PrescriptionSummary } from '../model/types';

import { endMenuEntries } from './end-menu-entries';

/**
 * Per-prescription actions — the inline eye opens the detail page; the ⋯
 * menu holds the D-19 lifecycle actions (renew, cancel with a reason),
 * cross-feature navigation (patient / record / labs), the AI medication
 * review, and real print/export through the shared export engine.
 *
 * Before D-19 this menu was view/print/export/AI only: four ways to look at
 * a prescription and none to act on one.
 */

export interface PrescriptionRowActionsProps {
  prescription: PrescriptionSummary;
  onOpen: (prescription: PrescriptionSummary) => void;
  onRenew?: ((prescription: PrescriptionSummary) => void) | undefined;
  onEnd?: ((prescription: PrescriptionSummary) => void) | undefined;
}

export function PrescriptionRowActions({
  prescription,
  onOpen,
  onRenew,
  onEnd,
}: PrescriptionRowActionsProps) {
  const navigate = useNavigate();
  const patientId = prescription.patient.id;

  const lifecycleEntries: MenuEntry[] =
    onRenew === undefined && onEnd === undefined
      ? []
      : [
          ...(onRenew
            ? [
                {
                  id: 'renew',
                  label: 'Renew prescription',
                  icon: RotateCcw,
                  disabled: !isRenewable(prescription),
                  onSelect: () => onRenew(prescription),
                } satisfies MenuEntry,
              ]
            : []),
          ...(onEnd ? endMenuEntries(prescription, () => onEnd(prescription), Ban) : []),
          { type: 'separator', id: 'sep-lifecycle' } satisfies MenuEntry,
        ];

  const entries: MenuEntry[] = [
    { id: 'view', label: 'View prescription', icon: Eye, onSelect: () => onOpen(prescription) },
    ...lifecycleEntries,
    {
      id: 'view-patient',
      label: 'View patient',
      icon: UserRound,
      onSelect: () => navigate(routes.doctor.patient(patientId)),
    },
    {
      id: 'view-record',
      label: 'View medical record',
      icon: FolderHeart,
      onSelect: () => navigate(`${routes.doctor.medicalRecords}?patient=${patientId}`),
    },
    {
      id: 'view-labs',
      label: 'View labs',
      icon: FlaskConical,
      onSelect: () => navigate(`${routes.doctor.labs}?patient=${patientId}`),
    },
    { type: 'separator', id: 'sep-documents' },
    {
      id: 'ai',
      label: 'AI medication review',
      icon: MedoraAiLogo,
      onSelect: () =>
        navigate(
          `${routes.doctor.assistant}?context=pharmacy&refId=${prescription.id}&patientId=${patientId}`,
        ),
    },
    {
      id: 'print',
      label: 'Print prescription',
      icon: Printer,
      onSelect: () => printDataset(prescriptionDataset(prescription)),
    },
    {
      id: 'export-pdf',
      label: 'Export PDF',
      icon: FileDown,
      onSelect: () => exportPdf(prescriptionDataset(prescription)),
    },
  ];

  return (
    <div
      className="flex flex-wrap items-center justify-end gap-1"
      onClick={(event) => event.stopPropagation()}
    >
      <Tooltip content="View prescription">
        <IconButton
          icon={Eye}
          size="sm"
          aria-label={`View prescription ${prescription.id}`}
          onClick={() => onOpen(prescription)}
        />
      </Tooltip>
      <Dropdown
        align="end"
        menuLabel={`Actions for ${prescription.id}`}
        entries={entries}
        trigger={
          <IconButton
            icon={EllipsisVertical}
            size="sm"
            aria-label={`More actions for ${prescription.id}`}
          />
        }
      />
    </div>
  );
}
