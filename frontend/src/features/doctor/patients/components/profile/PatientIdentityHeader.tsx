import {
  CalendarPlus,
  EllipsisVertical,
  FileText,
  Flag,
  MessageSquare,
  Pill,
  Printer,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { useDoctorProfile } from '@/app/providers';
import { Alert } from '@/components/feedback';
import { PAGE_TITLE_CLASS } from '@/components/layout';
import { StatusBadge } from '@/components/patterns';
import { Avatar, Button, Card, Dropdown, IconButton } from '@/components/ui';
import { dataErrorReportService } from '@/features/shared-domain/data-error-reports';
import {
  PATIENT_STATUS_META,
  RISK_LEVEL_META,
  type Patient,
} from '@/features/shared-domain/patient-identity';
import { useDisclosure } from '@/hooks/useDisclosure';
import { useT } from '@/i18n';
import { routes } from '@/routes';
import { MedoraAiLogo } from '@/shared/components/branding';
import { exportPdf, printDataset } from '@/utils/export';

import { patientSummaryDataset } from '../../model/patient-export';
import { ALLERGY_SEVERITY_META, type AllergyRecord } from '../../model/profile-types';

import { ReportDataErrorDialog } from './ReportDataErrorDialog';

/**
 * Identity header — the UX 2.3 custom composite: photo, name (page h1),
 * key facts, status/risk badges, quick actions, and the FIXED allergy
 * strip (UX 1.5 rule 4: allergy data renders in a non-dismissible
 * position in the patient header — never only in a tab).
 */
export interface PatientIdentityHeaderProps {
  patient: Patient;
  allergies: readonly AllergyRecord[];
  onViewRecord: () => void;
}

export function PatientIdentityHeader({
  patient,
  allergies,
  onViewRecord,
}: PatientIdentityHeaderProps) {
  const t = useT();
  const navigate = useNavigate();
  const { profile } = useDoctorProfile();
  const reportDialog = useDisclosure();
  const hasSevere = allergies.some((allergy) => allergy.severity === 'severe');
  const statusMeta = PATIENT_STATUS_META[patient.status];
  const riskMeta = RISK_LEVEL_META[patient.riskLevel];

  return (
    <Card>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-4">
            <Avatar name={patient.name} size="lg" decorative />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className={PAGE_TITLE_CLASS}>{patient.name}</h1>
                <StatusBadge status={statusMeta.kind} label={t(statusMeta.labelKey)} />
                <StatusBadge status={riskMeta.kind} label={`Risk: ${riskMeta.label}`} />
              </div>
              <p className="mt-1 text-body-sm text-text-secondary">
                {/* Latin-only from end to end, so pinned as one run: isolating
                    the blood group alone would carry it to the far end of an
                    RTL line ("O+ MRN … Blood"); `docs/handoff/i18n.md` §5. */}
                <span dir="ltr">
                  <span className="font-mono">MRN {patient.mrn}</span>
                  {' · '}
                  <span className="font-mono">{patient.id}</span>
                  {' · '}
                  {patient.age} y · {patient.gender === 'female' ? 'Female' : 'Male'} · Blood{' '}
                  {patient.bloodType}
                </span>
              </p>
              <p className="mt-0.5 text-body-sm text-text-tertiary">
                Assigned to {patient.assignedDoctor}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              leadingIcon={CalendarPlus}
              onClick={() => navigate(routes.doctor.bookAppointment({ patientId: patient.id }))}
            >
              Schedule appointment
            </Button>
            <Button
              variant="secondary"
              leadingIcon={MessageSquare}
              onClick={() => navigate(routes.doctor.composeMessage({ patientId: patient.id }))}
            >
              Send message
            </Button>
            <Button variant="secondary" leadingIcon={FileText} onClick={onViewRecord}>
              Medical record
            </Button>
            <Button
              variant="ai"
              leadingIcon={MedoraAiLogo}
              onClick={() =>
                navigate(`${routes.doctor.assistant}?context=patient&patientId=${patient.id}`)
              }
            >
              Medora AI
            </Button>
            <Dropdown
              align="end"
              menuLabel={`More actions for ${patient.name}`}
              entries={[
                {
                  id: 'prescriptions',
                  label: 'Prescriptions',
                  icon: Pill,
                  onSelect: () => navigate(`${routes.doctor.pharmacy}?patient=${patient.id}`),
                },
                {
                  id: 'print',
                  label: 'Print summary',
                  icon: Printer,
                  onSelect: () => printDataset(patientSummaryDataset(patient, allergies)),
                },
                {
                  id: 'export',
                  label: 'Export as PDF',
                  icon: FileText,
                  onSelect: () => exportPdf(patientSummaryDataset(patient, allergies)),
                },
                // Was a `mailto:` carrying the patient's name and MRN in the
                // subject: nothing recorded, nothing routed, and PHI handed
                // to whatever mail client the machine has. It now files a
                // report the administrators' queue reads (D-07) — where one
                // exists. A live build has no patient-level report route, so
                // the entry is absent there rather than toasting a report
                // into a queue nobody can read.
                ...(dataErrorReportService.available
                  ? ([
                      { type: 'separator', id: 'sep' },
                      {
                        id: 'flag',
                        label: 'Flag a data error',
                        icon: Flag,
                        onSelect: reportDialog.open,
                      },
                    ] as const)
                  : []),
              ]}
              trigger={<IconButton icon={EllipsisVertical} aria-label="More profile actions" />}
            />
          </div>
        </div>

        {allergies.length > 0 ? (
          <Alert
            variant={hasSevere ? 'error' : 'warning'}
            critical
            title={`Allergies: ${allergies
              .map(
                (allergy) =>
                  `${allergy.allergen} (${ALLERGY_SEVERITY_META[allergy.severity].label.toLowerCase()})`,
              )
              .join(' · ')}`}
          />
        ) : null}
      </div>

      <ReportDataErrorDialog
        patient={patient}
        reportedBy={profile.fullName}
        open={reportDialog.isOpen}
        onClose={reportDialog.close}
      />
    </Card>
  );
}
