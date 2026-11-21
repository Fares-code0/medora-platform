import { useEffect, useState } from 'react';

import { Send } from 'lucide-react';

import { Alert } from '@/components/feedback';
import { Button, Input, Modal, Select } from '@/components/ui';

import { CLINICS, ROLE_TEMPLATES } from './doctors';

/**
 * Invite a doctor (ADM-02 · UX §3.2).
 *
 * Email, specialty and a role template — the three things the onboarding
 * invite needs. The role template is chosen here rather than after the
 * doctor arrives so their first session already has the right capabilities;
 * it is the same list the administrative fields on the profile offer.
 */
export function InviteDoctorDialog({
  open,
  specialties,
  submitting,
  error,
  onClose,
  onConfirm,
}: {
  open: boolean;
  specialties: readonly string[];
  submitting: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (email: string, specialty: string, roleTemplate: string) => void;
}) {
  const firstSpecialty = specialties[0] ?? 'General Medicine';
  const [email, setEmail] = useState('');
  const [specialty, setSpecialty] = useState(firstSpecialty);
  const [roleTemplate, setRoleTemplate] = useState(ROLE_TEMPLATES[0] ?? 'Consultant');
  const [emailError, setEmailError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (open) {
      setEmail('');
      setSpecialty(firstSpecialty);
      setRoleTemplate(ROLE_TEMPLATES[0] ?? 'Consultant');
      setEmailError(undefined);
    }
  }, [open, firstSpecialty]);

  const submit = () => {
    if (email.trim().length === 0) {
      setEmailError('An email address is required.');
      return;
    }
    setEmailError(undefined);
    onConfirm(email, specialty, roleTemplate);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Invite a doctor"
      description="They receive an onboarding link and upload their credentials before they can see a patient."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button leadingIcon={Send} loading={submitting} onClick={submit}>
            Send invitation
          </Button>
        </>
      }
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {error ? (
          <Alert variant="error" title="Nothing was sent">
            {error}
          </Alert>
        ) : null}

        <Input
          type="email"
          label="Work email"
          placeholder="name@medora.health"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={emailError}
        />

        <Select
          label="Specialty"
          options={specialties.map((name) => ({ value: name, label: name }))}
          value={specialty}
          onChange={setSpecialty}
        />

        <Select
          label="Role template"
          helperText="Sets the capabilities their account starts with; changeable later."
          options={ROLE_TEMPLATES.map((name) => ({ value: name, label: name }))}
          value={roleTemplate}
          onChange={setRoleTemplate}
        />

        <p className="text-caption text-text-secondary">
          They join as <strong className="font-semibold">Pending verification</strong> and appear in
          the queue once their documents arrive. Clinic assignment ({CLINICS[0] ?? 'Medora Central'}{' '}
          by default) can be set on their profile.
        </p>
      </form>
    </Modal>
  );
}
