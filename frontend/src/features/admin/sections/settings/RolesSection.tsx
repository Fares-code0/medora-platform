import { useState } from 'react';

import { Plus } from 'lucide-react';

import { useToast } from '@/app/providers';
import { Badge, Button } from '@/components/ui';

import type { AccessRole } from '../../access/access-service';
import { CreateRoleDialog } from '../../access/CreateRoleDialog';
import { useAccessRoles, useCreateRoleMutation } from '../../access/useAccessQueries';
import { AsyncSection } from '../../components/primitives';
import { PLATFORM_ROLE_LABEL, PLATFORM_ROLES, type PlatformRole } from '../../permissions';
import { adminRefusal } from '../../refusal';

/** A role's name: the server's list, then the platform names, then the code. */
function labelOf(code: string, roles: readonly AccessRole[]): string {
  const listed = roles.find((role) => role.code === code)?.label;
  if (listed !== undefined) return listed;
  return (PLATFORM_ROLES as readonly string[]).includes(code)
    ? PLATFORM_ROLE_LABEL[code as PlatformRole]
    : code;
}

/**
 * Every role on the platform (API §15.1) and custom-role creation (§15.4),
 * under the permission matrix (UX §3.9 — "custom role creation from a base
 * template").
 *
 * The list is the server's, so a role another administrator created — or one
 * made through the API — appears here with its base and its members, rather
 * than as an unlabelled code. A custom role is shown as what it is today
 * (DEC-013): its permissions are a copy of its base's taken when it was
 * created, it has no matrix column, and its holders cannot use this web app.
 */
export function RolesSection() {
  const { toast } = useToast();
  const roles = useAccessRoles();
  const create = useCreateRoleMutation();
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const list = roles.data ?? [];
  const custom = list.filter((role) => !role.system);

  return (
    <section aria-labelledby="roles-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 id="roles-heading" className="text-h4 font-semibold text-text-primary">
            Roles
          </h3>
          <p className="text-caption text-text-secondary">
            The platform roles have a column in the matrix above. A custom role copies a platform
            role’s permissions when it is created.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          leadingIcon={Plus}
          onClick={() => {
            setCreateError(null);
            setCreating(true);
          }}
          disabled={roles.data === undefined}
        >
          New custom role
        </Button>
      </div>

      <AsyncSection
        isLoading={roles.isLoading}
        isError={roles.isError}
        error={roles.error}
        onRetry={() => void roles.refetch()}
      >
        <ul className="flex flex-col divide-y divide-border rounded-surface border border-border">
          {list.map((role) => (
            <li key={role.code} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
              <span className="text-body-sm font-medium text-text-primary">{role.label}</span>
              <code className="font-mono text-caption text-text-tertiary">{role.code}</code>
              {role.system ? (
                <Badge variant="neutral">Platform</Badge>
              ) : (
                <Badge variant="info">Custom</Badge>
              )}
              {role.baseRole !== null ? (
                <span className="text-caption text-text-secondary">
                  Based on {labelOf(role.baseRole, list)}
                </span>
              ) : null}
              <span className="ms-auto text-caption text-text-secondary">
                {role.members} {role.members === 1 ? 'account' : 'accounts'} · {role.activeMembers}{' '}
                active
              </span>
              {!role.system ? (
                <span className="basis-full text-caption text-text-tertiary">
                  No web workspace yet — its accounts can use the API, not this app.
                </span>
              ) : null}
            </li>
          ))}
        </ul>
        {custom.length === 0 ? (
          <p className="text-caption text-text-tertiary">No custom roles yet.</p>
        ) : null}
      </AsyncSection>

      <CreateRoleDialog
        open={creating}
        submitting={create.isPending}
        error={createError}
        existingCodes={list.map((role) => role.code)}
        onClose={() => setCreating(false)}
        onConfirm={(input) => {
          setCreateError(null);
          create.mutate(input, {
            onSuccess: (role) => {
              setCreating(false);
              toast({
                variant: 'success',
                title: 'Role created',
                description: `${role.label} starts with ${PLATFORM_ROLE_LABEL[input.baseRole]}’s permissions.`,
              });
            },
            onError: (error) => setCreateError(adminRefusal(error)),
          });
        }}
      />
    </section>
  );
}
