import { useEffect, useMemo, useRef, useState } from 'react';

import { Lock, RotateCcw, ShieldAlert, Undo2 } from 'lucide-react';
import { Link } from 'react-router-dom';

import { useAuth, useToast } from '@/app/providers';
import { Alert } from '@/components/feedback';
import { Badge, Button, ConfirmationDialog, Modal, Switch, Tooltip } from '@/components/ui';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { formatDateWith } from '@/i18n';
import { routes } from '@/routes';
import { cn } from '@/utils/cn';

import {
  accessCapabilities,
  useMatrixPreview,
  usePermissionMatrix,
  useResetPermissionsMutation,
  useRoleCounts,
  useSavePermissionsMutation,
} from '../../access/useAccessQueries';
import { SETTINGS_PANELS } from '../../admin-settings.types';
import { AsyncSection, Overline, Panel } from '../../components/primitives';
import {
  diffMatrix,
  isPermissionConflict,
  lockOf,
  orphanedCapabilities,
  PERMISSION_CAPABILITIES,
  PERMISSION_GROUPS,
  PLATFORM_ROLES,
  PLATFORM_ROLE_LABEL,
  previewAffectedByCounts,
  setCapability,
  type CapabilityMeta,
  type MatrixPreview,
  type PermissionChange,
  type PermissionMatrix,
  type PermissionMatrixState,
  type PlatformRole,
} from '../../permissions';
import { adminRefusal } from '../../refusal';

import { RolesSection } from './RolesSection';

/**
 * ADM-09 — the permission-matrix editor (UX §3.9).
 *
 * The grid is the whole point, so it is a real `<table>`: role columns are
 * `<th scope="col">`, capability rows are `<th scope="row">`, and each group
 * heading is a `scope="colgroup"` row, which is what lets a screen reader
 * announce "Prescribe, Doctor" on a cell instead of "switch, checked".
 *
 * Nothing here writes through to storage directly. The draft is local, and
 * the diff against the persisted matrix drives the editing affordances
 * (changed cells, the save bar). The review dialog shows the access service's
 * dry run instead — on the live API, `POST /roles/matrix/preview`, which
 * compares the draft with the matrix as stored now and counts the accounts it
 * reaches — and Apply waits for it. Only the confirmed save writes, and it is
 * refused if another administrator saved first.
 */

const ROLE_COLUMNS = PLATFORM_ROLES;

function panelMeta() {
  const found = SETTINGS_PANELS.find((panel) => panel.id === 'roles');
  if (!found) throw new Error('Unknown settings panel: roles');
  return found;
}

function formatStamp(iso: string): string {
  return formatDateWith(new Date(iso), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * The panel frame and its two reads: the matrix with its revision, and the
 * active accounts per role that a change would reach. Both come through the
 * access service — the live API's `/roles/matrix` and `/roles` in a live
 * build, the demo settings store otherwise (FE-10.10).
 */
export function PermissionMatrixPanel() {
  const info = panelMeta();
  const matrix = usePermissionMatrix();
  const counts = useRoleCounts();

  if (matrix.data !== undefined && counts.data !== undefined) {
    return (
      <PermissionMatrixEditor
        persisted={matrix.data}
        activeByRole={counts.data}
        onConflictResolved={() => void matrix.refetch()}
      />
    );
  }

  return (
    <Panel title={info.label} description={info.description} icon={info.icon}>
      <AsyncSection
        isLoading={matrix.isLoading || counts.isLoading}
        isError={matrix.isError || counts.isError}
        error={matrix.error ?? counts.error}
        onRetry={() => {
          void matrix.refetch();
          void counts.refetch();
        }}
      >
        {null}
      </AsyncSection>
    </Panel>
  );
}

function PermissionMatrixEditor({
  persisted,
  activeByRole,
  onConflictResolved,
}: {
  persisted: PermissionMatrixState;
  activeByRole: Readonly<Record<PlatformRole, number>>;
  /** Re-reads the stored matrix once the editor has rebased on theirs. */
  onConflictResolved: () => void;
}) {
  const info = panelMeta();
  const { user } = useAuth();
  const { toast } = useToast();
  const save = useSavePermissionsMutation();
  const reset = useResetPermissionsMutation();

  const [draft, setDraft] = useState<PermissionMatrix>(persisted.matrix);
  const [review, setReview] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [conflict, setConflict] = useState<PermissionMatrixState | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Resync when the persisted matrix moves under us (our own save, a reset,
  // or a conflict resolved by taking theirs). Keyed on revision so an
  // in-progress edit is never clobbered by an unrelated document refetch.
  const lastRevision = useRef(persisted.revision);
  useEffect(() => {
    if (lastRevision.current !== persisted.revision) {
      lastRevision.current = persisted.revision;
      setDraft(persisted.matrix);
      setSaveError(null);
    }
  }, [persisted.revision, persisted.matrix]);

  const changes = useMemo(() => diffMatrix(persisted.matrix, draft), [persisted.matrix, draft]);
  const orphans = useMemo(() => orphanedCapabilities(draft), [draft]);
  const affected = useMemo(
    () => previewAffectedByCounts(changes, activeByRole),
    [changes, activeByRole],
  );
  const dirty = changes.length > 0;
  const preview = useMatrixPreview(draft, review);

  const blocker = useUnsavedChangesGuard(dirty);

  const changedCells = useMemo(() => {
    const keys = new Set<string>();
    for (const change of changes) keys.add(`${change.role}:${change.capability.id}`);
    return keys;
  }, [changes]);

  const toggle = (role: PlatformRole, capability: CapabilityMeta, granted: boolean) => {
    setDraft((current) => setCapability(current, role, capability.id, granted));
  };

  const discard = () => {
    setDraft(persisted.matrix);
    setSaveError(null);
    setConfirmDiscard(false);
  };

  const commit = () => {
    setSaveError(null);
    save
      .mutateAsync({
        matrix: draft,
        baseRevision: persisted.revision,
        actor: user?.name ?? 'Administrator',
      })
      .then(
        () => {
          setReview(false);
          // The dry run the administrator confirmed; Apply is not offered without it.
          const applied = preview.data?.changes.length ?? changes.length;
          const reached = preview.data?.users ?? affected.users;
          toast({
            variant: 'success',
            title: 'Permissions updated',
            description: `${String(applied)} ${applied === 1 ? 'change' : 'changes'} applied to ${String(reached)} ${reached === 1 ? 'account' : 'accounts'}.`,
          });
        },
        (error: unknown) => {
          setReview(false);
          if (isPermissionConflict(error)) {
            setConflict(error.current);
            return;
          }
          // A lock or an orphan is a 409 that names the cells; anything else
          // is worded by kind. Either way nothing was written.
          setSaveError(`${adminRefusal(error)} Nothing was changed.`);
          toast({ variant: 'error', title: 'Could not save permissions' });
        },
      );
  };

  const resetDefaults = () => {
    setConfirmReset(false);
    reset.mutateAsync(user?.name ?? 'Administrator').then(
      () => toast({ variant: 'success', title: 'Permission matrix reset to defaults' }),
      () => toast({ variant: 'error', title: 'Could not reset the matrix' }),
    );
  };

  /** Take the other administrator's matrix, dropping this draft. */
  const acceptTheirs = () => {
    if (!conflict) return;
    lastRevision.current = conflict.revision;
    setDraft(conflict.matrix);
    setConflict(null);
    // The stored matrix is theirs now; reading it makes the draft clean
    // rather than "their changes, unsaved". `lastRevision` already matches,
    // so the resync effect leaves the draft alone.
    onConflictResolved();
  };

  /** Re-apply this draft on top of their revision. */
  const keepMine = () => {
    if (!conflict) return;
    const mine = draft;
    lastRevision.current = conflict.revision;
    save
      .mutateAsync({
        matrix: mine,
        baseRevision: conflict.revision,
        actor: user?.name ?? 'Administrator',
      })
      .then(
        () => {
          setConflict(null);
          toast({ variant: 'success', title: 'Your changes were applied over theirs' });
        },
        () => toast({ variant: 'error', title: 'Could not apply your changes' }),
      );
  };

  const blocked = blocker.state === 'blocked';

  return (
    <Panel
      title={info.label}
      description={info.description}
      icon={info.icon}
      action={
        // No reset route on the live API (FE-10.10): offered only where it
        // would do something.
        accessCapabilities.resetMatrix ? (
          <Button
            variant="ghost"
            size="sm"
            leadingIcon={RotateCcw}
            loading={reset.isPending}
            onClick={() => setConfirmReset(true)}
          >
            Reset defaults
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-caption text-text-tertiary">
            Revision {persisted.revision} · updated {formatStamp(persisted.updatedAt)} by{' '}
            {persisted.updatedBy}
          </p>
          <Legend />
        </div>

        <RoleMembers activeByRole={activeByRole} />

        {/* Announced rather than only shown — the save bar is visual. */}
        <p aria-live="polite" className="sr-only">
          {dirty
            ? `${String(changes.length)} unsaved permission ${changes.length === 1 ? 'change' : 'changes'}.`
            : 'No unsaved permission changes.'}
        </p>

        {saveError ? (
          <Alert variant="error" title="Save failed">
            {saveError}
          </Alert>
        ) : null}

        {orphans.length > 0 ? (
          <Alert variant="warning" title="No role would hold these capabilities">
            {orphans.map((capability) => capability.label).join(', ')}. Grant each to at least one
            role before saving — otherwise nobody on the platform can reach the feature.
          </Alert>
        ) : null}

        <MatrixTable
          draft={draft}
          changedCells={changedCells}
          activeByRole={activeByRole}
          onToggle={toggle}
        />
        <MatrixCards draft={draft} changedCells={changedCells} onToggle={toggle} />

        <RolesSection />

        {dirty ? (
          <div className="sticky bottom-0 z-sticky -mx-1 flex flex-wrap items-center justify-between gap-3 rounded-surface border border-border bg-surface-overlay px-4 py-3 shadow-modal">
            <p className="flex items-center gap-2 text-body-sm font-medium text-text-secondary">
              <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-pill bg-warning" />
              {changes.length} unsaved {changes.length === 1 ? 'change' : 'changes'} ·{' '}
              {affected.users} {affected.users === 1 ? 'account' : 'accounts'} affected
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                leadingIcon={Undo2}
                onClick={() => setConfirmDiscard(true)}
              >
                Discard
              </Button>
              <Button size="sm" disabled={orphans.length > 0} onClick={() => setReview(true)}>
                Review &amp; save
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <ReviewDialog
        open={review}
        preview={preview.data}
        edited={changedCells}
        checking={preview.isFetching}
        checkError={preview.isError ? preview.error : null}
        onRetryCheck={() => void preview.refetch()}
        saving={save.isPending}
        onClose={() => setReview(false)}
        onConfirm={commit}
      />

      <ConflictDialog
        conflict={conflict}
        base={persisted.matrix}
        draft={draft}
        saving={save.isPending}
        onAcceptTheirs={acceptTheirs}
        onKeepMine={keepMine}
      />

      <ConfirmationDialog
        open={confirmDiscard}
        onClose={() => setConfirmDiscard(false)}
        onConfirm={discard}
        title={`Discard ${String(changes.length)} unsaved ${changes.length === 1 ? 'change' : 'changes'}?`}
        description="The matrix returns to its last saved state. This cannot be undone."
        confirmLabel="Discard changes"
      />

      <ConfirmationDialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        onConfirm={resetDefaults}
        title="Reset the permission matrix to defaults?"
        description="Every role returns to its baseline capability set. Accounts keep their roles; only what those roles can do changes."
        confirmLabel="Reset matrix"
      />

      <ConfirmationDialog
        open={blocked}
        onClose={() => blocker.reset?.()}
        onConfirm={() => blocker.proceed?.()}
        title="Leave with unsaved permission changes?"
        description={`${String(changes.length)} ${changes.length === 1 ? 'change is' : 'changes are'} not saved. Leaving this panel discards them.`}
        confirmLabel="Leave and discard"
        cancelLabel="Stay on this page"
      />
    </Panel>
  );
}

/* ── Legend ───────────────────────────────────────────────────── */

function Legend() {
  return (
    <ul className="flex flex-wrap items-center gap-4 text-caption text-text-tertiary">
      <li className="flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className="h-2.5 w-2.5 rounded-control bg-warning-subtle ring-1 ring-warning"
        />
        Changed, not saved
      </li>
      <li className="flex items-center gap-1.5">
        <Lock aria-hidden="true" className="h-3 w-3" strokeWidth={2} />
        Fixed by policy
      </li>
      <li className="flex items-center gap-1.5">
        <ShieldAlert aria-hidden="true" className="h-3 w-3 text-error" strokeWidth={2} />
        Touches patient data
      </li>
    </ul>
  );
}

/* ── One editable cell ────────────────────────────────────────── */

interface CellProps {
  capability: CapabilityMeta;
  role: PlatformRole;
  checked: boolean;
  changed: boolean;
  onToggle: (role: PlatformRole, capability: CapabilityMeta, granted: boolean) => void;
}

function MatrixSwitch({ capability, role, checked, changed, onToggle }: CellProps) {
  const lock = lockOf(capability.id, role);
  const roleLabel = PLATFORM_ROLE_LABEL[role];

  if (lock) {
    return (
      <Tooltip content={lock.reason}>
        <span className="inline-flex items-center gap-1.5">
          <Switch
            checked={lock.value}
            disabled
            onCheckedChange={() => undefined}
            aria-label={`${capability.label} for ${roleLabel} — locked ${lock.value ? 'on' : 'off'}. ${lock.reason}`}
          />
          <Lock aria-hidden="true" className="h-3 w-3 text-text-tertiary" strokeWidth={2} />
        </span>
      </Tooltip>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex rounded-pill p-0.5',
        changed && 'bg-warning-subtle ring-1 ring-warning',
      )}
    >
      <Switch
        checked={checked}
        onCheckedChange={(next) => onToggle(role, capability, next)}
        aria-label={`${capability.label} for ${roleLabel}${changed ? ` — changed to ${checked ? 'allowed' : 'not allowed'}, unsaved` : ''}`}
      />
    </span>
  );
}

/* ── Members by role ──────────────────────────────────────────── */

/**
 * UX §3.9's per-role member list. The Users panel already lists, searches and
 * edits accounts and filters by role, so each role links there with the
 * filter applied rather than this panel growing a second, read-only copy.
 * One link per role at every width; the column headers keep their plain count.
 */
function RoleMembers({ activeByRole }: { activeByRole: Readonly<Record<PlatformRole, number>> }) {
  return (
    <nav aria-label="Accounts by role" className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <Overline>Accounts by role</Overline>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {ROLE_COLUMNS.map((role) => (
          <li key={role}>
            <Link
              to={`${routes.admin.settings('users')}?role=${role}`}
              className="touch-target inline-flex min-h-6 items-center rounded-control text-body-sm font-medium text-primary [--touch-y:10px] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              {PLATFORM_ROLE_LABEL[role]} · {activeByRole[role]} active
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/* ── Desktop: the grid ────────────────────────────────────────── */

interface GridProps {
  draft: PermissionMatrix;
  changedCells: ReadonlySet<string>;
  onToggle: CellProps['onToggle'];
}

function MatrixTable({
  draft,
  changedCells,
  activeByRole,
  onToggle,
}: GridProps & { activeByRole: Readonly<Record<PlatformRole, number>> }) {
  return (
    // Wide by nature: the table scrolls inside its own box rather than
    // pushing the page sideways.
    <div className="hidden overflow-x-auto rounded-surface border border-border md:block">
      <table className="w-full min-w-[720px] border-collapse text-start">
        <caption className="sr-only">
          Platform capabilities by role. Each cell is a switch: on means the role holds the
          capability.
        </caption>
        <thead>
          <tr className="border-b border-border bg-surface-sunken">
            <th
              scope="col"
              className="w-[38%] px-4 py-3 text-caption font-semibold text-text-secondary"
            >
              Capability
            </th>
            {ROLE_COLUMNS.map((role) => (
              <th key={role} scope="col" className="px-3 py-3 text-center">
                <span className="block text-caption font-semibold text-text-primary">
                  {PLATFORM_ROLE_LABEL[role]}
                </span>
                <span className="block text-caption font-normal text-text-tertiary">
                  {activeByRole[role]} active
                </span>
              </th>
            ))}
          </tr>
        </thead>
        {PERMISSION_GROUPS.map((group) => {
          const rows = PERMISSION_CAPABILITIES.filter((capability) => capability.group === group);
          if (rows.length === 0) return null;
          return (
            <tbody key={group} className="divide-y divide-border">
              <tr className="bg-surface-sunken/60">
                <th
                  scope="colgroup"
                  colSpan={ROLE_COLUMNS.length + 1}
                  className="px-4 py-2 text-start"
                >
                  <Overline>{group}</Overline>
                </th>
              </tr>
              {rows.map((capability) => (
                <tr key={capability.id} className="align-top">
                  <th scope="row" className="px-4 py-3 font-normal">
                    <span className="flex items-center gap-2 text-body-sm font-medium text-text-primary">
                      {capability.label}
                      {capability.phi === true ? (
                        <Badge variant="error" icon={ShieldAlert}>
                          PHI
                        </Badge>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block text-caption font-normal text-text-secondary">
                      {capability.description}
                    </span>
                  </th>
                  {ROLE_COLUMNS.map((role) => (
                    <td key={role} className="px-3 py-3 text-center">
                      <MatrixSwitch
                        capability={capability}
                        role={role}
                        checked={draft[role].includes(capability.id)}
                        changed={changedCells.has(`${role}:${capability.id}`)}
                        onToggle={onToggle}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}

/* ── Mobile: one card per capability ──────────────────────────── */

function MatrixCards({ draft, changedCells, onToggle }: GridProps) {
  return (
    <div className="flex flex-col gap-5 md:hidden">
      {PERMISSION_GROUPS.map((group) => {
        const rows = PERMISSION_CAPABILITIES.filter((capability) => capability.group === group);
        if (rows.length === 0) return null;
        return (
          <section key={group} aria-label={group} className="flex flex-col gap-3">
            <Overline>{group}</Overline>
            {rows.map((capability) => (
              <div
                key={capability.id}
                className="rounded-surface border border-border bg-surface-sunken/40 p-3"
              >
                <p className="flex items-center gap-2 text-body-sm font-medium text-text-primary">
                  {capability.label}
                  {capability.phi === true ? (
                    <Badge variant="error" icon={ShieldAlert}>
                      PHI
                    </Badge>
                  ) : null}
                </p>
                <p className="mt-0.5 text-caption text-text-secondary">{capability.description}</p>
                <ul className="mt-3 flex flex-col divide-y divide-border">
                  {ROLE_COLUMNS.map((role) => (
                    <li key={role} className="flex items-center justify-between gap-3 py-2">
                      <span className="text-body-sm text-text-secondary">
                        {PLATFORM_ROLE_LABEL[role]}
                      </span>
                      <MatrixSwitch
                        capability={capability}
                        role={role}
                        checked={draft[role].includes(capability.id)}
                        changed={changedCells.has(`${role}:${capability.id}`)}
                        onToggle={onToggle}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}

/* ── Review & save ────────────────────────────────────────────── */

function ChangeLine({ change }: { change: PermissionChange }) {
  return (
    <li className="flex flex-wrap items-center gap-2 py-1.5 text-body-sm">
      <Badge variant={change.next ? 'success' : 'neutral'}>
        {change.next ? 'Grant' : 'Revoke'}
      </Badge>
      <span className="text-text-primary">{change.capability.label}</span>
      <span className="text-text-tertiary">· {PLATFORM_ROLE_LABEL[change.role]}</span>
    </li>
  );
}

/**
 * The confirmation screen, over the dry run rather than the editor's own
 * diff: the server's answer accounts for its locks, for an orphan its save
 * would refuse, and for the accounts each role holds now. Apply is offered
 * only once that answer is in and says the save can succeed.
 */
function ReviewDialog({
  open,
  preview,
  edited,
  checking,
  checkError,
  onRetryCheck,
  saving,
  onClose,
  onConfirm,
}: {
  open: boolean;
  preview: MatrixPreview | undefined;
  /** `role:capability` keys of the cells this editor changed. */
  edited: ReadonlySet<string>;
  checking: boolean;
  checkError: unknown;
  onRetryCheck: () => void;
  saving: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  // A refetch after an error keeps the old error until it settles; show the check instead.
  const failed = checkError !== null && !checking;
  const ready = preview !== undefined && !checking && !failed;
  const applicable = ready && preview.changes.length > 0 && preview.orphaned.length === 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      role="alertdialog"
      dismissible={false}
      title="Review permission changes"
      description="Every change here is attributed to your account and written to the audit log."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Back to editing
          </Button>
          <Button onClick={onConfirm} loading={saving} disabled={!applicable}>
            {ready
              ? `Apply ${String(preview.changes.length)} ${preview.changes.length === 1 ? 'change' : 'changes'}`
              : 'Apply changes'}
          </Button>
        </>
      }
    >
      {failed ? (
        <Alert variant="error" title="Couldn’t check this change">
          <span className="flex flex-col items-start gap-2">
            <span>{adminRefusal(checkError)} Nothing has been saved.</span>
            <Button variant="secondary" size="sm" onClick={onRetryCheck}>
              Check again
            </Button>
          </span>
        </Alert>
      ) : !ready ? (
        <p role="status" className="text-body-sm text-text-secondary">
          Checking what this change would do…
        </p>
      ) : (
        <ReviewSummary preview={preview} edited={edited} />
      )}
    </Modal>
  );
}

function ReviewSummary({
  preview,
  edited,
}: {
  preview: MatrixPreview;
  edited: ReadonlySet<string>;
}) {
  // The dry run compares with the matrix as stored now. A change to a cell
  // this editor never touched means someone saved since it was opened —
  // applying would undo their cell, so say so before Apply rather than after.
  const untouched = preview.changes.filter(
    (change) => !edited.has(`${change.role}:${change.capability.id}`),
  ).length;

  if (preview.changes.length === 0) {
    return (
      <p className="text-body-sm text-text-secondary">
        Saving would change nothing: every cell you changed is fixed by platform policy.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {untouched > 0 ? (
        <Alert variant="warning" title="The matrix changed since you opened it">
          {untouched} of these changes {untouched === 1 ? 'is a cell' : 'are cells'} you did not
          edit — another administrator saved in the meantime, and applying this draft would undo
          their {untouched === 1 ? 'change' : 'changes'}. Applying first shows both sets so you can
          choose.
        </Alert>
      ) : null}
      {preview.orphaned.length > 0 ? (
        <Alert variant="error" title="No role would hold these capabilities">
          {preview.orphaned.map((capability) => capability.label).join(', ')}. The save would be
          refused — go back and grant each to at least one role.
        </Alert>
      ) : null}

      <div className="rounded-surface border border-border bg-surface-sunken p-3">
        <Overline>Affected accounts</Overline>
        <p className="mt-1 text-body-sm text-text-primary">
          {preview.users} active {preview.users === 1 ? 'account' : 'accounts'} across{' '}
          {preview.roles.length} {preview.roles.length === 1 ? 'role' : 'roles'}.
        </p>
        <ul className="mt-2 flex flex-col gap-1">
          {preview.roles.map((entry) => (
            <li key={entry.role} className="text-caption text-text-tertiary">
              {PLATFORM_ROLE_LABEL[entry.role]} — {entry.users}{' '}
              {entry.users === 1 ? 'account' : 'accounts'}
              {entry.grants > 0 ? `, +${String(entry.grants)} granted` : ''}
              {entry.revokes > 0 ? `, −${String(entry.revokes)} revoked` : ''}
            </li>
          ))}
        </ul>
      </div>

      {preview.phiGrants.length > 0 ? (
        <Alert variant="warning" title="This grants access to patient data">
          {preview.phiGrants
            .map((change) => `${change.capability.label} → ${PLATFORM_ROLE_LABEL[change.role]}`)
            .join('; ')}
          . Holders still pass the per-access justification gate, and every access is logged.
        </Alert>
      ) : null}

      <div>
        <Overline>Changes</Overline>
        <ul className="mt-1 divide-y divide-border">
          {preview.changes.map((change) => (
            <ChangeLine key={`${change.role}:${change.capability.id}`} change={change} />
          ))}
        </ul>
      </div>
    </div>
  );
}

/* ── Concurrent-edit merge (UX §3.9) ──────────────────────────── */

function ConflictDialog({
  conflict,
  base,
  draft,
  saving,
  onAcceptTheirs,
  onKeepMine,
}: {
  conflict: PermissionMatrixState | null;
  base: PermissionMatrix;
  draft: PermissionMatrix;
  saving: boolean;
  onAcceptTheirs: () => void;
  onKeepMine: () => void;
}) {
  const theirs = useMemo(
    () => (conflict ? diffMatrix(base, conflict.matrix) : []),
    [conflict, base],
  );
  const mine = useMemo(() => diffMatrix(base, draft), [base, draft]);

  return (
    <Modal
      open={conflict !== null}
      onClose={onAcceptTheirs}
      role="alertdialog"
      dismissible={false}
      title="Someone else saved first"
      description={
        conflict
          ? `${conflict.updatedBy} saved revision ${String(conflict.revision)} while this panel was open. Nothing of yours was written.`
          : undefined
      }
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onAcceptTheirs} disabled={saving}>
            Take theirs
          </Button>
          <Button onClick={onKeepMine} loading={saving}>
            Apply mine over theirs
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Overline>Their changes</Overline>
          <ul className="mt-1 divide-y divide-border">
            {theirs.length > 0 ? (
              theirs.map((change) => (
                <ChangeLine key={`t-${change.role}:${change.capability.id}`} change={change} />
              ))
            ) : (
              <li className="py-1.5 text-body-sm text-text-tertiary">No cell differences.</li>
            )}
          </ul>
        </div>
        <div>
          <Overline>Your changes</Overline>
          <ul className="mt-1 divide-y divide-border">
            {mine.map((change) => (
              <ChangeLine key={`m-${change.role}:${change.capability.id}`} change={change} />
            ))}
          </ul>
        </div>
      </div>
    </Modal>
  );
}
