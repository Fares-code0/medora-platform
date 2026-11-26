/**
 * The category and severity taxonomy (UX §3.7, API §14.1, RM M28.1).
 *
 * ## Why this is derived from `action` rather than supplied by callers
 *
 * `AuditEvent` was fixed at M2 with the explicit promise that "eighteen
 * modules will call `record()` before M28 exists, and none of them should
 * need editing when the real dispatcher lands". Seventy call sites later,
 * that promise is worth keeping: adding `category` and `severity` to the
 * interface would mean seventy edits and seventy chances to classify one
 * wrongly. The action is already a dotted `entity.verb`, so the entity
 * decides the category and a short list of verbs decides the severity.
 *
 * ## An unknown entity is `system`, and it is logged
 *
 * There is no silent default that guesses a plausible category. An entity
 * absent from the table below files as `system` **and** the dispatcher
 * warns with the action name, so a new module that skipped this file is
 * visible in the log rather than quietly mis-filed under `user_action`.
 * `audit-taxonomy.spec.ts` asserts every action the codebase actually
 * emits is classified here, so the warning should never fire in practice.
 */

/** API §14.1's five categories. */
export type AuditCategory =
  | 'authentication'
  | 'security'
  | 'user_action'
  | 'admin_activity'
  | 'system';

/** API §14.1's three severities. */
export type AuditSeverity = 'info' | 'warning' | 'critical';

/**
 * Entity → category, keyed by the part of the action before the dot.
 *
 * The split follows §14.1's own words. `authentication` is getting in and
 * out. `security` is what changes who *can* get in, or reaches past a
 * privacy boundary. `admin_activity` is one account acting on the
 * platform or on another account. `user_action` is clinical and personal
 * work — the bulk of it. `system` is nobody's act.
 */
const CATEGORY_BY_ENTITY: Readonly<Record<string, AuditCategory>> = {
  auth: 'authentication',
  session: 'authentication',

  // Trusting a device and reaching another user's message content are
  // both changes to a boundary rather than ordinary work.
  device: 'security',
  communication_access: 'security',
  // Unmasking a patient's identity (M7.3) is reaching past the masking
  // boundary — the same kind of act as reading message content.
  patient_identity: 'security',
  // Re-sealing stored second factors under a new envelope key (M37 key
  // rotation) changes nothing about who may sign in, but it rewrites the
  // ciphertext every second factor depends on.
  encryption_key: 'security',

  admin: 'admin_activity',
  user: 'admin_activity',
  roles: 'admin_activity',
  platform_settings: 'admin_activity',
  message_flag: 'admin_activity',
  // Working the record-issue queue (RM M12.7) is an administrator acting
  // on a clinician's report — the same kind of act as resolving a flag.
  record_issue: 'admin_activity',
  // M30.1 — running a background job outside its schedule is one
  // account acting on the platform, which is §14.1's `admin_activity`.
  job: 'admin_activity',
  // Multi-hospital §2.2–§2.6: staffing lifecycle and administrative scope.
  hospital: 'admin_activity',
  platform: 'admin_activity',
  // §2.11–§2.12: reaching past a hospital boundary, or deciding who can.
  exceptional_access: 'security',
  // §2.13: reading the ledger is itself recorded.
  audit_ledger: 'admin_activity',
  // §2.13: a read of clinical content or clear identity.
  phi: 'user_action',
  information_request: 'user_action',

  account: 'user_action',
  settings: 'user_action',
  // `ai.conversation.create` — three segments, not two. The entity is
  // still everything before the first dot, and this entry exists because
  // the coverage spec's first regex only matched two-segment actions and
  // let this one through to `system`.
  ai: 'user_action',
  // ADR-050 — the patient assistant: `patient_ai.context.read`, thread create/delete.
  patient_ai: 'user_action',
  doctor: 'user_action',
  patient: 'user_action',
  // `legacy_clinical_record.read` — the safety screen consulted a legacy
  // (unattributed) allergy or prescription (H2).
  legacy_clinical_record: 'user_action',
  appointment: 'user_action',
  medical_record: 'user_action',
  lab_order: 'user_action',
  lab_result: 'user_action',
  lab_attachment: 'user_action',
  prescription: 'user_action',
  file: 'user_action',
};

/**
 * The actions that are not `info`.
 *
 * Keyed by the whole action, because severity is about the verb and not
 * the entity: creating a patient is routine, deactivating one is not.
 *
 * `critical` is reserved for the two things an investigator would want to
 * find first — a replayed refresh token, which is either theft or a
 * client bug and is treated as theft (ADR-026), and a permission matrix
 * rewritten, which can change what everyone on the platform may reach.
 *
 * `auth.refresh_grace_replay_accepted` is deliberately absent, and so
 * `info`: it is the retired token re-presented inside ADR-045's 30-second
 * window and answered with the same successor — a lost response or a
 * second tab, not a replay. A retired token that fails the grace checks
 * is still `auth.refresh_reuse_detected`, and still critical.
 *
 * `auth.refresh_replay_on_revoked_session` is `warning`: a retired token
 * presented against a session that was **already** revoked — by a
 * logout, a password reset, an administrator, or a concurrent replay that
 * already raised the critical row. Nothing is revoked by it (nothing is
 * left to revoke), so it is not a second critical event for one theft;
 * it is still recorded, because a stolen token being tried after the
 * victim signed out is exactly what an investigator needs to see.
 */
const SEVERITY_BY_ACTION: Readonly<Record<string, AuditSeverity>> = {
  'auth.refresh_reuse_detected': 'critical',
  'auth.refresh_replay_on_revoked_session': 'warning',
  'roles.matrix_update': 'critical',

  // Reaching past a privacy boundary, or changing who can.
  'communication_access.approve': 'warning',
  'communication_access.view': 'warning',
  'communication_access.revoke': 'warning',
  'patient_identity.reveal': 'warning',
  'roles.user_overrides': 'warning',
  'roles.create': 'warning',
  // Changing who may act at which hospital, or across all of them.
  'hospital.doctor_employment_ended': 'warning',
  'hospital.doctor_transferred': 'warning',
  'hospital.staff_affiliation_ended': 'warning',
  'hospital.admin_assigned': 'warning',
  'hospital.admin_revoked': 'warning',
  'platform.admin_granted': 'critical',
  'platform.admin_revoked': 'warning',
  'exceptional_access.emergency_override': 'critical',
  'exceptional_access.request': 'warning',
  'exceptional_access.approve': 'warning',
  'exceptional_access.read': 'warning',
  'information_request.approve': 'warning',
  'information_request.read': 'warning',
  'user.administer': 'warning',
  'device.trust': 'warning',
  'session.revoke': 'warning',
  'auth.two_factor_disable': 'warning',
  // A second factor bypassed by a printed code, or replaced (owner
  // decisions R1, Q7 / R4): both change how the account can be entered.
  'auth.recovery_code_used': 'warning',
  'auth.two_factor_reenrolled': 'warning',
  'auth.password_reset': 'warning',
  // A failed lock-screen unlock is a guess against a live session.
  'auth.reauthenticate_failed': 'warning',
  // An operator re-encrypting every stored envelope (M37 key rotation):
  // the start, the outcome, and a run that stopped part-way.
  'encryption_key.reencrypt_started': 'warning',
  'encryption_key.reencrypted': 'warning',
  'encryption_key.reencrypt_failed': 'warning',

  // Platform-wide configuration, and the two slices §19.2 calls risky
  // arrive here as `platform_settings.security_updated` and
  // `…retention_updated`.
  'platform_settings.security_updated': 'warning',
  'platform_settings.retention_updated': 'warning',
  'platform_settings.api_key_issued': 'warning',
  'platform_settings.api_key_revoked': 'warning',

  // Off-schedule platform work (M30.1). `warning` rather than `info`
  // because the registry includes the retention sweep, whose day job is
  // to `DROP TABLE` — an administrator running that by hand at an
  // unexpected hour is exactly the row an investigator would want to
  // find beside a missing partition.
  'job.trigger': 'warning',
  'job.replay': 'warning',

  // Bulk PHI leaving the system as a file (API §4.10, §6.10, §7.10,
  // §8.11). One row per export rather than per patient, so the severity
  // is what lets an investigator of a leak find it first.
  'patient.export': 'warning',
  'medical_record.export': 'warning',
  'prescription.export': 'warning',
  'lab_order.export': 'warning',

  // Clinical acts whose reversal is expensive or whose subject is gone.
  'patient.deactivate': 'warning',
  'appointment.cancel_administratively': 'warning',
  'medical_record.report_issue': 'warning',
  'file.delete': 'warning',
};

/**
 * Verbs whose past participle is not `<verb>d`.
 *
 * Keyed by the whole verb where the phrase needs rewording, and by the
 * final word where the `<word>d` rule is simply wrong. Verbs already
 * written in the past — `…_updated`, `…_issued`, `…_detected` — need no
 * entry: `summarise` leaves a word ending in `ed` alone, which is what
 * keeps the eleven dynamic `platform_settings.<slice>_updated` actions
 * out of this table.
 */
const PARTICIPLES: Readonly<Record<string, string>> = {
  // Whole verbs, where the words have to be reordered or reworded.
  attach_to_record: 'attached to a record',
  // Multi-hospital §2.11–§2.13.
  emergency_override: 'used as an Emergency Override',
  cancel_administratively: 'cancelled by an administrator',
  propose_slots: 'slots proposed',
  report_issue: 'issue reported',
  two_factor_setup: 'two-factor set up',

  investigate: 'taken for investigation',
  reauthenticate: 're-authenticated',
  reauthenticate_failed: 're-authentication failed',
  add: 'added',
  download: 'downloaded',
  export: 'exported',
  reassign: 'reassigned',
  setup: 'set up',
  create: 'created',
  create_draft: 'drafted',
  delete: 'deleted',
  discard: 'discarded',
  enter: 'entered',
  login: 'signed in',
  logout: 'signed out',
  register: 'registered',
  remove: 'removed',
  renew: 'renewed',
  replay: 'replayed',
  request: 'requested',
  reset: 'reset',
  resolve: 'resolved',
  reveal: 'revealed',
  review: 'reviewed',
  review_bulk: 'reviewed in bulk',
  revoke: 'revoked',
  sign: 'signed',
  transition: 'moved',
  trigger: 'triggered',
  trust: 'trusted',
  untrust: 'untrusted',
  upload: 'uploaded',
  view: 'viewed',
  // Verbs whose past tense is not `+d` (multi-hospital §2.11–§2.13).
  read: 'read',
  reject: 'rejected',
};

export interface Classification {
  readonly category: AuditCategory;
  readonly severity: AuditSeverity;
  readonly summary: string;
  /** True when the entity was not in the table — the dispatcher warns. */
  readonly unclassified: boolean;
}

/** Everything the ledger needs that the caller did not state. */
export function classify(action: string): Classification {
  const dot = action.indexOf('.');
  const entity = dot === -1 ? action : action.slice(0, dot);
  const verb = dot === -1 ? '' : action.slice(dot + 1);
  const category = CATEGORY_BY_ENTITY[entity];

  return {
    category: category ?? 'system',
    severity: SEVERITY_BY_ACTION[action] ?? 'info',
    summary: summarise(entity, verb),
    unclassified: category === undefined,
  };
}

/**
 * The human line, e.g. `Prescription signed`.
 *
 * `audit_events.event_type` carries the action verbatim for a client to
 * branch on, so this is prose and may be reworded — the same division
 * `shared/activity` records between its `kind` and its `summary`. It
 * names *what happened* and never a value: the target id goes in
 * `target`, and clinical content goes nowhere near here (MG §11.6).
 */
function summarise(entity: string, verb: string): string {
  const subject = humanise(entity);
  // Split on both separators: `ai.conversation.create`'s verb is
  // `conversation.create`, and splitting on `_` alone left the dot in
  // the prose — "Ai conversation.created".
  const words = verb.split(/[._]/);
  // `note_add` is "note added", not "note_add"ed: the participle applies
  // to the last word, and anything before it is part of the subject.
  // A whole-verb entry replaces the phrase outright. Prepending the
  // modifier to it as well is what produced "Appointment cancel
  // cancelled by an administrator" in the first draft — the entries in
  // that half of the table exist precisely because the words have to be
  // reordered, so the original order must not survive.
  const whole = PARTICIPLES[verb];
  if (whole !== undefined) return `${subject} ${whole}`.trim().slice(0, 300);

  const last = words.at(-1) ?? '';
  const modifier = words.slice(0, -1).join(' ');
  // A verb already written in the past stays as it is. Without this the
  // eleven `platform_settings.<slice>_updated` actions — and every other
  // `…ed` verb — would read "updatedd".
  const participle = PARTICIPLES[last] ?? (last.endsWith('ed') ? last : `${last}d`);
  const phrase = modifier === '' ? participle : `${modifier} ${participle}`;

  return `${subject} ${phrase}`.trim().slice(0, 300);
}

function humanise(value: string): string {
  const words = value.replace(/_/g, ' ');

  return words.charAt(0).toUpperCase() + words.slice(1);
}
