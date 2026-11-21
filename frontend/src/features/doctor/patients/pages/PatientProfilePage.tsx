import { useCallback, useState } from 'react';

import { UserRoundX } from 'lucide-react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { useAuth } from '@/app/providers';
import { Alert, EmptyState, ErrorState, Skeleton } from '@/components/feedback';
import { PageContainer, PageSections, Stack } from '@/components/layout';
import { Breadcrumb, Card, LinkButton, Tabs, type TabItem } from '@/components/ui';
import { routes } from '@/routes';

import { usePatientDocumentAccess } from '../api/usePatientDocumentAccess';
import {
  PATIENT_NOT_FOUND,
  usePatientProfileQuery,
  usePatientTabQuery,
} from '../api/usePatientProfileQuery';
import { AddHistoryEventDialog } from '../components/profile/AddHistoryEventDialog';
import { AllergiesTab } from '../components/profile/AllergiesTab';
import { AppointmentsTab } from '../components/profile/AppointmentsTab';
import { ChartNoteDialog, SignChartNoteDialog } from '../components/profile/ChartNoteDialogs';
import {
  RemoveContactDialog,
  RemoveHistoryEventDialog,
  ResolveAlertDialog,
} from '../components/profile/ChartRetractionDialogs';
import { DocumentsTab } from '../components/profile/DocumentsTab';
import { EmergencyContactDialog } from '../components/profile/EmergencyContactDialog';
import { HistoryTab } from '../components/profile/HistoryTab';
import { MedicationsTab } from '../components/profile/MedicationsTab';
import { NotesTab } from '../components/profile/NotesTab';
import { OverviewTab } from '../components/profile/OverviewTab';
import { PatientIdentityHeader } from '../components/profile/PatientIdentityHeader';
import { PatientLabStudiesTab } from '../components/profile/PatientLabStudiesTab';
import { PatientSummarySidebar } from '../components/profile/PatientSummarySidebar';
import { ProfileTabPanel } from '../components/profile/ProfileTabPanel';
import { RaiseAlertDialog } from '../components/profile/RaiseAlertDialog';
import { RecordAllergyDialog } from '../components/profile/RecordAllergyDialog';
import { RecordVitalsDialog } from '../components/profile/RecordVitalsDialog';
import { StudyCategoriesTab } from '../components/profile/StudyCategoriesTab';
import type {
  ClinicalAlert,
  ClinicalNote,
  EmergencyContact,
  MedicalHistoryEvent,
} from '../model/profile-types';

/**
 * Patient profile — UX 2.3 (P2 detail page).
 * Identity header + fixed allergy strip, persistent summary column
 * (sticky on lg+, below the tabs on smaller screens per UX §5.2), and
 * nine tab panels. The active tab lives in ?tab= (UX §1.3 contract), so
 * deep links like ?tab=history from the patients table land directly. An
 * unknown value opens Overview.
 */

/**
 * Tab order is clinical reading order: the record's findings (history ·
 * medications · allergies), then the studies that produce new ones.
 */
const TAB_IDS = [
  'overview',
  'history',
  'medications',
  'allergies',
  'labs',
  'imaging',
  'appointments',
  'notes',
  'documents',
] as const;

type TabId = (typeof TAB_IDS)[number];

function isTabId(value: string): value is TabId {
  return (TAB_IDS as readonly string[]).includes(value);
}

/** A tab's count, once its record has been loaded — never a guess before. */
function countOf(data: readonly unknown[] | undefined): { count?: number } {
  return data === undefined ? {} : { count: data.length };
}

function ProfileSkeleton() {
  return (
    <Stack gap={6} aria-busy="true">
      <Card>
        <div className="flex items-start gap-4">
          <Skeleton className="h-16 w-16 rounded-pill" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-1/4" />
          </div>
        </div>
      </Card>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card padding="compact">
          <Stack gap={3}>
            <Skeleton className="mx-auto h-24 w-24 rounded-pill" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </Stack>
        </Card>
        <div className="lg:col-span-2">
          <Stack gap={3}>
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-40 w-full rounded-surface" />
            <Skeleton className="h-40 w-full rounded-surface" />
          </Stack>
        </div>
      </div>
    </Stack>
  );
}

export function PatientProfilePage() {
  const { patientId = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const query = usePatientProfileQuery(patientId);
  // Whether a stored file can be opened at all is a deployment fact, not a
  // per-patient one, so the tab is handed the answer rather than each row
  // discovering it on click (D-04).
  const documentAccess = usePatientDocumentAccess(patientId);
  const [recordingAllergy, setRecordingAllergy] = useState(false);
  const [recordingVitals, setRecordingVitals] = useState(false);
  const [raisingAlert, setRaisingAlert] = useState(false);
  const [addingHistory, setAddingHistory] = useState(false);
  const [removingHistory, setRemovingHistory] = useState<MedicalHistoryEvent | null>(null);
  /** `undefined` closed, `null` adding, a contact when editing that one. */
  /** `undefined` closed, `null` writing a new note, a note when correcting that one. */
  const [noteDialog, setNoteDialog] = useState<ClinicalNote | null | undefined>(undefined);
  const [signingNote, setSigningNote] = useState<ClinicalNote | null>(null);
  const [resolvingAlert, setResolvingAlert] = useState<ClinicalAlert | null>(null);
  const [removingContact, setRemovingContact] = useState<EmergencyContact | null>(null);
  const [contactDialog, setContactDialog] = useState<EmergencyContact | null | undefined>(
    undefined,
  );

  const rawTab = searchParams.get('tab');
  const tab: TabId = rawTab !== null && isTabId(rawTab) ? rawTab : 'overview';

  const setTab = useCallback(
    (next: string) => {
      setSearchParams(
        (previous) => {
          const params = new URLSearchParams(previous);
          if (next === 'overview') params.delete('tab');
          else params.set('tab', next);
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // Each record-bearing tab is read only while it is open (FE-10.2 — every
  // tab read is an audited view server-side). Hooks run unconditionally;
  // `enabled` is what keeps an unopened tab from being fetched.
  const history = usePatientTabQuery(patientId, 'history', tab === 'history');
  const medications = usePatientTabQuery(patientId, 'medications', tab === 'medications');
  const notes = usePatientTabQuery(patientId, 'notes', tab === 'notes');
  const documents = usePatientTabQuery(patientId, 'documents', tab === 'documents');
  const imaging = usePatientTabQuery(patientId, 'imaging', tab === 'imaging');

  const notFound =
    query.isError && query.error instanceof Error && query.error.message === PATIENT_NOT_FOUND;

  const breadcrumb = (
    <Breadcrumb
      items={[
        { label: 'Overview', href: routes.doctor.overview },
        { label: 'Patients', href: routes.doctor.patients },
        { label: query.data?.patient.name ?? 'Patient profile' },
      ]}
    />
  );

  if (query.isPending) {
    return (
      <PageContainer width="2xl">
        <PageSections>
          {breadcrumb}
          <ProfileSkeleton />
        </PageSections>
      </PageContainer>
    );
  }

  if (notFound) {
    return (
      <PageContainer width="2xl">
        <PageSections>
          {breadcrumb}
          <EmptyState
            icon={UserRoundX}
            title="Patient not found"
            headingLevel="h1"
            description={`No patient with id "${patientId}" is under your care.`}
            action={
              <LinkButton href={routes.doctor.patients} variant="secondary">
                Back to patients
              </LinkButton>
            }
          />
        </PageSections>
      </PageContainer>
    );
  }

  if (query.isError || query.data === undefined) {
    // Header failure = full-section error; identity is non-negotiable
    // context for a clinical page (UX 2.3).
    return (
      <PageContainer width="2xl">
        <PageSections>
          {breadcrumb}
          <ErrorState
            title="Couldn't load this patient"
            headingLevel="h1"
            onRetry={() => void query.refetch()}
          />
        </PageSections>
      </PageContainer>
    );
  }

  const bundle = query.data;
  const { profile } = bundle;
  const viewMedications = () => setTab('medications');

  const tabs: readonly TabItem[] = [
    {
      value: 'overview',
      label: 'Overview',
      content: (
        <OverviewTab
          bundle={bundle}
          onViewMedications={viewMedications}
          onRecordVitals={() => setRecordingVitals(true)}
          onRaiseAlert={() => setRaisingAlert(true)}
          onAddContact={() => setContactDialog(null)}
          onEditContact={setContactDialog}
          onRemoveContact={setRemovingContact}
          onResolveAlert={setResolvingAlert}
        />
      ),
    },
    {
      value: 'history',
      label: 'Medical history',
      ...countOf(history.data),
      content: (
        <ProfileTabPanel query={history} label="medical history">
          {(events) => (
            <HistoryTab
              events={events}
              onAdd={() => setAddingHistory(true)}
              onRemove={setRemovingHistory}
            />
          )}
        </ProfileTabPanel>
      ),
    },
    {
      value: 'medications',
      label: 'Medications',
      ...countOf(medications.data),
      content: (
        <ProfileTabPanel query={medications} label="medications">
          {(rows) => <MedicationsTab medications={rows} />}
        </ProfileTabPanel>
      ),
    },
    {
      value: 'allergies',
      label: 'Allergies',
      count: profile.allergies.length,
      content: (
        <AllergiesTab allergies={profile.allergies} onRecord={() => setRecordingAllergy(true)} />
      ),
    },
    {
      value: 'labs',
      label: 'Lab results',
      content: <PatientLabStudiesTab patientId={bundle.patient.id} />,
    },
    {
      value: 'imaging',
      label: 'Imaging',
      content: (
        <ProfileTabPanel query={imaging} label="imaging studies">
          {(categories) => (
            <StudyCategoriesTab
              categories={categories}
              notice={
                <Alert variant="info" title="Imaging reports are not available in this build">
                  Studies ordered for this patient are listed below, but no imaging or PACS service
                  is connected, so there is no report to open. The lab side of D-05 reads real
                  orders; imaging has no equivalent source anywhere in the app.
                </Alert>
              }
            />
          )}
        </ProfileTabPanel>
      ),
    },
    {
      value: 'appointments',
      label: 'Appointments',
      count: profile.appointments.length,
      content: <AppointmentsTab appointments={profile.appointments} />,
    },
    {
      value: 'notes',
      label: 'Notes',
      ...countOf(notes.data),
      content: (
        <ProfileTabPanel query={notes} label="notes">
          {(rows) => (
            <NotesTab
              notes={rows}
              currentUserId={user?.id}
              onAdd={() => setNoteDialog(null)}
              onEdit={setNoteDialog}
              onSign={setSigningNote}
            />
          )}
        </ProfileTabPanel>
      ),
    },
    {
      value: 'documents',
      label: 'Documents',
      ...countOf(documents.data),
      content: (
        <ProfileTabPanel query={documents} label="documents">
          {(rows) => (
            <DocumentsTab documents={rows} patientId={bundle.patient.id} access={documentAccess} />
          )}
        </ProfileTabPanel>
      ),
    },
  ];

  return (
    <PageContainer width="2xl">
      <PageSections>
        {breadcrumb}

        <PatientIdentityHeader
          patient={bundle.patient}
          allergies={profile.allergies}
          onViewRecord={() =>
            navigate(`${routes.doctor.medicalRecords}?patient=${bundle.patient.id}`)
          }
        />

        {/* P2 layout: summary column (4) + tabbed content (8) on lg+;
            content first, summary after, when stacked (UX §5.2). */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="order-2 lg:order-1 lg:col-span-4 xl:col-span-3">
            <div className="lg:sticky lg:top-6">
              <PatientSummarySidebar bundle={bundle} onViewMedications={viewMedications} />
            </div>
          </div>
          <div className="order-1 min-w-0 lg:order-2 lg:col-span-8 xl:col-span-9">
            <Tabs
              aria-label="Patient record sections"
              items={tabs}
              value={tab}
              onValueChange={setTab}
            />
          </div>
        </div>
      </PageSections>

      <RecordVitalsDialog
        open={recordingVitals}
        patientId={bundle.patient.id}
        patientName={bundle.patient.name}
        onClose={() => setRecordingVitals(false)}
      />
      <RecordAllergyDialog
        open={recordingAllergy}
        patientId={bundle.patient.id}
        patientName={bundle.patient.name}
        existing={profile.allergies}
        onClose={() => setRecordingAllergy(false)}
      />
      <RaiseAlertDialog
        open={raisingAlert}
        patientId={bundle.patient.id}
        patientName={bundle.patient.name}
        onClose={() => setRaisingAlert(false)}
      />
      <EmergencyContactDialog
        open={contactDialog !== undefined}
        patientId={bundle.patient.id}
        patientName={bundle.patient.name}
        contact={contactDialog ?? null}
        hasPrimary={profile.emergencyContacts.some((contact) => contact.isPrimary)}
        onClose={() => setContactDialog(undefined)}
      />
      <ChartNoteDialog
        open={noteDialog !== undefined}
        patientId={bundle.patient.id}
        patientName={bundle.patient.name}
        note={noteDialog ?? null}
        onClose={() => setNoteDialog(undefined)}
      />
      <SignChartNoteDialog
        patientId={bundle.patient.id}
        note={signingNote}
        onClose={() => setSigningNote(null)}
      />
      <ResolveAlertDialog
        patientId={bundle.patient.id}
        alert={resolvingAlert}
        onClose={() => setResolvingAlert(null)}
      />
      <RemoveContactDialog
        patientId={bundle.patient.id}
        contact={removingContact}
        remainingCount={Math.max(0, profile.emergencyContacts.length - 1)}
        onClose={() => setRemovingContact(null)}
      />
      <RemoveHistoryEventDialog
        patientId={bundle.patient.id}
        event={removingHistory}
        onClose={() => setRemovingHistory(null)}
      />
      <AddHistoryEventDialog
        open={addingHistory}
        patientId={bundle.patient.id}
        patientName={bundle.patient.name}
        onClose={() => setAddingHistory(false)}
      />
    </PageContainer>
  );
}
