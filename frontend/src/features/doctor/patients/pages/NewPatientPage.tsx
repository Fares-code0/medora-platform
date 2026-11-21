import { useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { ArrowLeft, UserPlus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { useDoctorProfile, useToast } from '@/app/providers';
import { ContentHeader, PageContainer, PageSections } from '@/components/layout';
import { Breadcrumb, Button, Card, Input, Select, Textarea } from '@/components/ui';
import {
  BLOOD_TYPES,
  patientDirectory,
  type BloodType,
  type Gender,
} from '@/features/shared-domain/patient-identity';
import { routes } from '@/routes';
import { isApiError } from '@/types/api';

import { useCreatePatientMutation } from '../api/usePatientsQuery';

/**
 * Add patient — a page of its own (`/doctor/patients/new`), the way New
 * Appointment is, replacing the modal the Patients list used to open. It
 * sits in the shell like every other page: sidebar, navbar, breadcrumb.
 *
 * The registration itself is unchanged: identity, contact and clinical
 * basics, validated and persisted through the patient directory (FE-10.2).
 * Required fields block submission with inline errors, and a field the
 * server refuses is marked inline with the server's own message rather than
 * a generic "try again". The list refreshes through query invalidation and a
 * success toast confirms; the page then opens the new patient's record, as
 * New Appointment opens the appointment it booked.
 *
 * One registration per submit: the button is disabled while the request is
 * in flight, and a ref guards the gap before that render lands, so a double
 * click sends one request.
 */

interface FormState {
  name: string;
  dateOfBirth: string;
  gender: Gender;
  phone: string;
  email: string;
  address: string;
  bloodType: BloodType;
  insurance: string;
  medicalNotes: string;
}

const INITIAL: FormState = {
  name: '',
  dateOfBirth: '',
  gender: 'female',
  phone: '',
  email: '',
  address: '',
  bloodType: 'O+',
  insurance: '',
  medicalNotes: '',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The phone rule the API applies (backend `patient.schema.ts`, the same
 * pattern registration uses), checked here first so a doctor is not sent
 * to the server to learn that brackets are not accepted.
 */
const PHONE_RE = /^\+?[0-9][0-9\s-]{6,18}$/;

/** Server field names → this form's fields (`fullName` is `name` here). */
const SERVER_FIELDS: Readonly<Record<string, keyof FormState>> = {
  fullName: 'name',
  dateOfBirth: 'dateOfBirth',
  phone: 'phone',
  email: 'email',
  address: 'address',
  medicalNotes: 'medicalNotes',
};

type ServerErrors = Partial<Record<keyof FormState, string>>;

function toServerErrors(error: unknown): ServerErrors | null {
  if (!isApiError(error) || error.kind !== 'validation') return null;
  const mapped: ServerErrors = {};
  for (const [field, messages] of Object.entries(error.fieldErrors)) {
    const key = SERVER_FIELDS[field];
    const message = messages[0];
    if (key !== undefined && message !== undefined) mapped[key] = message;
  }
  return mapped;
}

export function NewPatientPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { profile } = useDoctorProfile();
  const createPatient = useCreatePatientMutation();
  const [form, setForm] = useState<FormState>(INITIAL);
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<ServerErrors>({});
  const inFlight = useRef(false);
  const storesInsurance = patientDirectory.capabilities.insurance;
  const pending = createPatient.isPending;

  const nameError =
    (submitted && form.name.trim().length < 2 ? 'Enter the full name' : undefined) ??
    serverErrors.name;
  const dobError =
    (submitted && !form.dateOfBirth ? 'Enter the date of birth' : undefined) ??
    serverErrors.dateOfBirth;
  const phoneError =
    (submitted && !PHONE_RE.test(form.phone.trim()) ? 'Enter a valid phone number' : undefined) ??
    serverErrors.phone;
  const emailError =
    (submitted && form.email.trim() !== '' && !EMAIL_RE.test(form.email.trim())
      ? 'Enter a valid email'
      : undefined) ?? serverErrors.email;

  const isValid =
    form.name.trim().length >= 2 &&
    Boolean(form.dateOfBirth) &&
    PHONE_RE.test(form.phone.trim()) &&
    (form.email.trim() === '' || EMAIL_RE.test(form.email.trim()));

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((previous) => ({ ...previous, [key]: value }));
    // An edited field is no longer the value the server refused.
    setServerErrors((previous) => ({ ...previous, [key]: undefined }));
  };

  const backToList = () => navigate(routes.doctor.patients);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    if (!isValid || inFlight.current) return;
    inFlight.current = true;
    createPatient.mutate(
      { input: { ...form }, doctor: profile.fullName || 'Doctor' },
      {
        onSuccess: (patient) => {
          toast({
            variant: 'success',
            title: 'Patient added',
            description: `${patient.name} · ${patient.mrn}`,
          });
          navigate(routes.doctor.patient(patient.id));
        },
        onError: (error) => {
          const fieldErrors = toServerErrors(error);
          if (fieldErrors !== null && Object.keys(fieldErrors).length > 0) {
            setServerErrors(fieldErrors);
            return;
          }
          toast({
            variant: 'error',
            title: 'Could not add patient',
            description: 'Please try again.',
          });
        },
        onSettled: () => {
          inFlight.current = false;
        },
      },
    );
  };

  return (
    <PageContainer width="lg">
      <PageSections>
        <ContentHeader
          title="Add patient"
          caption="Register a new patient in your practice."
          icon={UserPlus}
          breadcrumb={
            <Breadcrumb
              items={[
                { label: 'Overview', href: routes.doctor.overview },
                { label: 'Patients', href: routes.doctor.patients },
                { label: 'Add patient' },
              ]}
            />
          }
          actions={
            <Button
              variant="secondary"
              leadingIcon={ArrowLeft}
              onClick={backToList}
              disabled={pending}
            >
              Back to patients
            </Button>
          }
        />

        <form noValidate onSubmit={submit} aria-label="Add patient" className="flex flex-col gap-6">
          <Card title="Identity" subtitle="Who the patient is.">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label="Full name"
                required
                autoComplete="off"
                value={form.name}
                error={nameError}
                onChange={(event) => set('name', event.target.value)}
              />
              <Input
                type="date"
                label="Date of birth"
                required
                value={form.dateOfBirth}
                error={dobError}
                onChange={(event) => set('dateOfBirth', event.target.value)}
              />
              <Select
                label="Gender"
                value={form.gender}
                onChange={(value) => set('gender', value as Gender)}
                options={[
                  { value: 'female', label: 'Female' },
                  { value: 'male', label: 'Male' },
                ]}
              />
              <Select
                label="Blood type"
                value={form.bloodType}
                onChange={(value) => set('bloodType', value as BloodType)}
                options={BLOOD_TYPES.map((value) => ({ value, label: value }))}
              />
            </div>
          </Card>

          <Card title="Contact" subtitle="How the practice reaches them.">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label="Phone"
                required
                value={form.phone}
                error={phoneError}
                onChange={(event) => set('phone', event.target.value)}
              />
              <Input
                type="email"
                label="Email"
                value={form.email}
                error={emailError}
                onChange={(event) => set('email', event.target.value)}
              />
              <div className="sm:col-span-2">
                <Input
                  label="Address"
                  value={form.address}
                  error={serverErrors.address}
                  onChange={(event) => set('address', event.target.value)}
                />
              </div>
            </div>
          </Card>

          <Card title="Clinical basics" subtitle="Context for the care team.">
            <div className="flex flex-col gap-4">
              {storesInsurance ? (
                <Input
                  label="Insurance"
                  placeholder="Provider · policy number"
                  value={form.insurance}
                  onChange={(event) => set('insurance', event.target.value)}
                />
              ) : null}
              <Textarea
                label="Medical notes"
                rows={4}
                value={form.medicalNotes}
                error={serverErrors.medicalNotes}
                onChange={(event) => set('medicalNotes', event.target.value)}
                placeholder="Allergies, chronic conditions, or context for the care team."
              />
            </div>
          </Card>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={backToList} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" leadingIcon={UserPlus} loading={pending}>
              Add patient
            </Button>
          </div>
        </form>
      </PageSections>
    </PageContainer>
  );
}
