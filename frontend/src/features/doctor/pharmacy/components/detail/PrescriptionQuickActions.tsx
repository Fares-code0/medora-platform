import {
  Ban,
  EllipsisVertical,
  FileDown,
  FlaskConical,
  FolderHeart,
  Printer,
  RotateCcw,
  UserRound,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { Button, Dropdown, IconButton, type MenuEntry } from '@/components/ui';
import { routes } from '@/routes';
import { MedoraAiLogo } from '@/shared/components/branding';
import { exportPdf, printDataset } from '@/utils/export';

import { prescriptionDataset } from '../../model/prescription-export';
import { isRenewable } from '../../model/selectors';
import type { Prescription } from '../../model/types';
import { endMenuEntries } from '../end-menu-entries';

/**
 * Prescription quick actions — View patient navigates to the profile;
 * Medical record and Labs open the patient's records/labs; Ask AI opens
 * the assistant seeded with this prescription (accent signature, DS
 * §7.3); the overflow menu carries the D-19 lifecycle actions (renew, and
 * cancel or discontinue with a reason as the status allows — DEC-002) and prints or exports the prescription through the
 * shared export engine (ContentHeader allows max 1 primary + 2 secondary,
 * so the lifecycle pair lives in the menu rather than as more buttons).
 */
export interface PrescriptionQuickActionsProps {
  prescription: Prescription;
  onRenew: (prescription: Prescription) => void;
  onEnd: (prescription: Prescription) => void;
}

export function PrescriptionQuickActions({
  prescription,
  onRenew,
  onEnd,
}: PrescriptionQuickActionsProps) {
  const navigate = useNavigate();
  const patientId = prescription.patient.id;

  const entries: MenuEntry[] = [
    {
      id: 'renew',
      label: 'Renew prescription',
      icon: RotateCcw,
      disabled: !isRenewable(prescription),
      onSelect: () => onRenew(prescription),
    },
    ...endMenuEntries(prescription, () => onEnd(prescription), Ban),
    { type: 'separator', id: 'sep-lifecycle' },
    {
      id: 'view-labs',
      label: 'View labs',
      icon: FlaskConical,
      onSelect: () => navigate(`${routes.doctor.labs}?patient=${patientId}`),
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
    <>
      <Button leadingIcon={UserRound} onClick={() => navigate(routes.doctor.patient(patientId))}>
        View patient
      </Button>
      <Button
        variant="secondary"
        leadingIcon={FolderHeart}
        onClick={() => navigate(`${routes.doctor.medicalRecords}?patient=${patientId}`)}
      >
        Medical record
      </Button>
      <Button
        variant="ai"
        leadingIcon={MedoraAiLogo}
        onClick={() =>
          navigate(
            `${routes.doctor.assistant}?context=pharmacy&refId=${prescription.id}&patientId=${patientId}`,
          )
        }
      >
        Ask AI
      </Button>
      <Dropdown
        align="end"
        menuLabel={`More actions for ${prescription.id}`}
        entries={entries}
        trigger={<IconButton icon={EllipsisVertical} aria-label="More prescription actions" />}
      />
    </>
  );
}
