import { useEffect, useState } from 'react';

import { Plus } from 'lucide-react';

import { Alert } from '@/components/feedback';
import { Button, Input, Modal, Select } from '@/components/ui';

import { PLATFORM_ROLE_LABEL, PLATFORM_ROLES, type PlatformRole } from '../permissions';

import { normalizeRoleCode, validateRoleDraft, type RoleDraftErrors } from './role-rules';

/**
 * A custom role from a base template (UX §3.9, API §15.4 — `POST /roles`).
 *
 * The base role has no default: picking whose permissions a new role starts
 * with is the decision, and a pre-selected one is a decision nobody made.
 * The dialog says what a custom role cannot do yet (DEC-013): its holders
 * keep the API's permissions, but the web client cannot open a workspace for
 * them, because the session names a role without its base.
 */
const BASE_OPTIONS = PLATFORM_ROLES.map((role) => ({
  value: role,
  label: PLATFORM_ROLE_LABEL[role],
}));

export function CreateRoleDialog({
  open,
  submitting,
  error,
  existingCodes,
  onClose,
  onConfirm,
}: {
  open: boolean;
  submitting: boolean;
  /** The refusal from the last attempt, already worded. */
  error: string | null;
  /** Codes already in use, so a duplicate is caught before the server's 409. */
  existingCodes: readonly string[];
  onClose: () => void;
  onConfirm: (input: { code: string; label: string; baseRole: PlatformRole }) => void;
}) {
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [baseRole, setBaseRole] = useState('');
  const [errors, setErrors] = useState<RoleDraftErrors>({});

  useEffect(() => {
    if (open) {
      setCode('');
      setLabel('');
      setBaseRole('');
      setErrors({});
    }
  }, [open]);

  const submit = () => {
    const found = validateRoleDraft({ code, label, baseRole }, existingCodes);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    onConfirm({
      code: normalizeRoleCode(code),
      label: label.trim(),
      baseRole: baseRole as PlatformRole,
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New custom role"
      description="A custom role starts with a copy of its base role’s permissions."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button leadingIcon={Plus} loading={submitting} onClick={submit}>
            Create role
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
          <Alert variant="error" title="No role was created">
            {error}
          </Alert>
        ) : null}

        <Input
          label="Name"
          placeholder="Ward clerk"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          error={errors.label}
          autoComplete="off"
        />

        <Input
          label="Code"
          placeholder="ward-clerk"
          helperText="Letters, digits, underscore and hyphen. Stored in lower case; it cannot be changed later."
          value={code}
          onChange={(event) => setCode(event.target.value)}
          error={errors.code}
          autoComplete="off"
          spellCheck={false}
        />

        <Select
          label="Base role"
          placeholder="Choose a base role"
          options={BASE_OPTIONS}
          value={baseRole === '' ? null : baseRole}
          onChange={setBaseRole}
          error={errors.baseRole}
        />

        <Alert variant="info" title="Not usable in this web app yet">
          Accounts given a custom role keep its permissions on the Medora API, but cannot sign in to
          this web app: the app opens a workspace by role, and the session does not yet say which
          base role a custom role came from. The role has no column in the matrix above.
        </Alert>
      </form>
    </Modal>
  );
}
