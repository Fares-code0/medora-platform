import { useEffect, useState } from 'react';

import { Send } from 'lucide-react';

import { Alert } from '@/components/feedback';
import { Button, Input, Modal, Select } from '@/components/ui';

import { PLATFORM_ROLE_LABEL } from '../permissions';

import { INVITABLE_ROLES, type InvitableRole } from './access-service';

/**
 * Invite a staff member (ADR-035 §5, FE-10.10) — `POST /auth/admin-invitations`.
 *
 * Email and role, nothing else. The invitation mints no password and sets
 * no second factor: the invitee receives a link in their own inbox, sets a
 * password, and — for an administrator — enrols an authenticator before
 * the account can sign in. Doctors are not invited here: they register
 * themselves and are verified from the Doctors screen.
 */
const ROLE_OPTIONS = INVITABLE_ROLES.map((role) => ({
  value: role,
  label: PLATFORM_ROLE_LABEL[role],
}));

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function InviteStaffDialog({
  open,
  submitting,
  error,
  onClose,
  onConfirm,
}: {
  open: boolean;
  submitting: boolean;
  /** The refusal from the last attempt, already worded. */
  error: string | null;
  onClose: () => void;
  onConfirm: (email: string, role: InvitableRole) => void;
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InvitableRole>('reception');
  const [emailError, setEmailError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (open) {
      setEmail('');
      setRole('reception');
      setEmailError(undefined);
    }
  }, [open]);

  const submit = () => {
    const address = email.trim();
    if (address.length === 0) {
      setEmailError('Enter an email address.');
      return;
    }
    if (!EMAIL.test(address)) {
      setEmailError('Enter a valid email address.');
      return;
    }
    setEmailError(undefined);
    onConfirm(address, role);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Invite a staff member"
      description="They receive a link to set their own password. Nobody else ever sees it."
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
          <Alert variant="error" title="No invitation was sent">
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
          autoComplete="off"
        />

        <Select
          label="Role"
          options={ROLE_OPTIONS}
          value={role}
          onChange={(value) => setRole(value as InvitableRole)}
        />

        <p className="text-caption text-text-secondary">
          {role === 'admin'
            ? 'An administrator must enrol an authenticator app while accepting, before the account can sign in.'
            : 'Their account starts with the role’s permissions from the matrix.'}{' '}
          Doctors register themselves and are verified from the Doctors screen.
        </p>
      </form>
    </Modal>
  );
}
