import {
  CheckCheck,
  EllipsisVertical,
  FileDown,
  FolderHeart,
  LineChart,
  Pill,
  Printer,
  UserRound,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { Button, Dropdown, IconButton } from '@/components/ui';
import { routes } from '@/routes';
import { MedoraAiLogo } from '@/shared/components/branding';
import { exportPdf, printDataset } from '@/utils/export';

import { labReportDataset } from '../../model/lab-export';
import type { LabTest } from '../../model/types';

/**
 * Lab quick actions — View patient navigates to the profile; Medical
 * record opens the patient's records; Ask AI opens the assistant seeded
 * with this lab order (accent signature, DS §7.3); the overflow menu prints
 * or exports the released results through the shared export engine.
 *
 * **D-11 put "Mark reviewed" first, and only while it applies.** On a result
 * still awaiting review it is the primary action on the page — ahead of View
 * patient, which was primary when this screen was read-only — and it
 * disappears once the result is reviewed rather than sitting there disabled.
 * It appears here and nowhere else on the page: attach-to-record is the
 * Review section's action, and repeating either would give one page two
 * controls with one name.
 */
export function LabQuickActions({
  test,
  onMarkReviewed,
  onViewTrend,
}: {
  test: LabTest;
  onMarkReviewed?: (() => void) | undefined;
  onViewTrend?: (() => void) | undefined;
}) {
  const navigate = useNavigate();
  const canReview = test.results.length > 0 && test.review === null;
  const canTrend = test.results.some((result) => result.numericValue !== null);

  return (
    <>
      {canReview && onMarkReviewed !== undefined ? (
        <Button leadingIcon={CheckCheck} onClick={onMarkReviewed}>
          Mark reviewed
        </Button>
      ) : null}
      <Button
        variant={canReview && onMarkReviewed !== undefined ? 'secondary' : 'primary'}
        leadingIcon={UserRound}
        onClick={() => navigate(routes.doctor.patient(test.patient.id))}
      >
        View patient
      </Button>
      {canTrend && onViewTrend !== undefined ? (
        <Button variant="secondary" leadingIcon={LineChart} onClick={onViewTrend}>
          View trend
        </Button>
      ) : null}
      <Button
        variant="ai"
        leadingIcon={MedoraAiLogo}
        onClick={() =>
          navigate(
            `${routes.doctor.assistant}?context=labs&refId=${test.id}&patientId=${test.patient.id}`,
          )
        }
      >
        Ask AI
      </Button>
      <Dropdown
        align="end"
        menuLabel={`More actions for ${test.id}`}
        entries={[
          {
            id: 'medical-record',
            label: 'Medical record',
            icon: FolderHeart,
            onSelect: () =>
              navigate(`${routes.doctor.medicalRecords}?patient=${test.patient.id}`),
          },
          {
            id: 'prescriptions',
            label: 'Prescriptions',
            icon: Pill,
            onSelect: () => navigate(`${routes.doctor.pharmacy}?patient=${test.patient.id}`),
          },
          {
            id: 'print',
            label: 'Print report',
            icon: Printer,
            onSelect: () => printDataset(labReportDataset(test)),
          },
          {
            id: 'export-pdf',
            label: 'Export PDF',
            icon: FileDown,
            onSelect: () => exportPdf(labReportDataset(test)),
          },
        ]}
        trigger={<IconButton icon={EllipsisVertical} aria-label="More lab actions" />}
      />
    </>
  );
}
