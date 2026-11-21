import { selectService } from '@/api/seam';

import { httpProfileService } from './http-profile-service';
import type { ActiveSession, PatientProfile, PrivacyState, ProfileService } from './model/types';

/**
 * Profile.
 *
 * ── The read is live; the write is a decision ────────────────────────
 *
 * `GET /me/profile` is served today by `patient-profile.controller.ts`
 * and returns `{ account, patient }`, where **`patient: null` is a
 * success** — the normal state right after signup, because ADR-030 §4
 * keeps account creation and clinical-record claiming apart. The
 * contract says why it is not a 404: a 404 on one's own profile is
 * indistinguishable from a broken session, and a mobile client's natural
 * response to that is to log the user out.
 *
 * `PATCH /me/profile` is blocked by **RA-030.2** — which fields a
 * patient may change, who wins when a clinician edits the same field,
 * whether an edit needs verification, and what an unlinked account does
 * are all unanswered. `listSessions`/`revokeSession` are blocked by
 * BE-10 (the users module, M8). The HTTP adapter refuses those three by
 * name and reads the profile for real.
 *
 * The fixture keeps its `editable: true` rows: they are the development
 * stand-in for AD-2's recommended outcome, and the seam is what stops
 * that stand-in reaching a patient.
 */

let profile: PatientProfile = {
  displayName: 'Sara Ahmed',
  photoUrl: null,
  linkedToClinicalRecord: true,
  fields: [
    {
      id: 'fullName',
      label: 'Full name',
      value: 'Sara Ahmed',
      editable: false,
      ownedBy: 'Your clinic',
    },
    {
      id: 'dateOfBirth',
      label: 'Date of birth',
      value: '1991-04-12',
      editable: false,
      ownedBy: 'Your clinic',
    },
    { id: 'bloodType', label: 'Blood type', value: 'O+', editable: false, ownedBy: 'Your clinic' },
    { id: 'email', label: 'Email', value: 'sara@example.com', editable: true, ownedBy: 'You' },
    { id: 'phone', label: 'Phone', value: '+962 79 000 0000', editable: true, ownedBy: 'You' },
    {
      id: 'address',
      label: 'Address',
      value: '22 Rainbow Street, Amman',
      editable: true,
      ownedBy: 'You',
    },
  ],
};

/**
 * Two, and the second one is the point.
 *
 * A fixture with only the current session leaves the P-06 revoke branch
 * unreachable in a development build: every row would render
 * `readOnly` and nobody would see the control they were working on. The
 * second row is an ordinary other device, deliberately not a sinister
 * one — "unrecognised device" is a state the screen's own notice covers
 * and not something to bake into the stand-in data.
 */
/**
 * Mutable, because `revokeSession` removes from it.
 *
 * The adapter's `revokeSession` was a no-op with a comment saying there
 * was nothing local to revoke, which left the control it backs untestable
 * by hand: a developer tapped "Sign out", the toast appeared, and the row
 * stayed. Removing it here is what makes the seam's development half
 * behave like the route it stands in for.
 */
let sessions: readonly ActiveSession[] = [
  {
    id: 'SS-1',
    deviceLabel: 'This phone',
    lastSeenAt: new Date().toISOString(),
    current: true,
  },
  {
    id: 'SS-2',
    deviceLabel: 'Tablet',
    lastSeenAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    current: false,
  },
];

function nowIso(): string {
  return new Date().toISOString();
}

let privacy: PrivacyState = {
  export: { status: 'none', requestedAt: null },
  deactivation: { status: 'none', requestedAt: null },
};

const fixtureProfileService: ProfileService = {
  async get() {
    return profile;
  },
  async update(values) {
    profile = {
      ...profile,
      fields: profile.fields.map((field) =>
        field.editable && values[field.id] !== undefined
          ? { ...field, value: values[field.id] ?? field.value }
          : field,
      ),
    };
    return profile;
  },
  async listSessions() {
    return sessions;
  },
  /**
   * Removes the row, so development exercises the whole control.
   *
   * The current session is refused here as well as hidden in the screen.
   * One caller enforcing a rule makes it look like that screen's
   * preference; the port refusing it makes it the rule it is — signing
   * this phone out is `logout`, which clears the PHI cache and the
   * keychain, and revoking it from a device list would leave the app
   * holding a dead token and believing it was signed in.
   */
  async revokeSession(id) {
    const target = sessions.find((session) => session.id === id);
    if (target === undefined || target.current) return;
    sessions = sessions.filter((session) => session.id !== id);
  },

  async getPrivacyState() {
    return privacy;
  },

  /**
   * Both requests move to `pending` and stay there.
   *
   * The fixture deliberately does NOT advance an export to `ready` on a
   * timer. A development stand-in that completes on its own teaches the
   * screen — and whoever reads it next — that the completion is this
   * client's to observe. It is not: the export finishes when the server
   * says so, and the patient learns through the notification the row
   * names. A fake that resolves is how a screen ends up polling for a
   * state nothing will ever publish.
   */
  async requestDataExport() {
    privacy = { ...privacy, export: { status: 'pending', requestedAt: nowIso() } };
    return privacy;
  },

  async requestDeactivation() {
    privacy = { ...privacy, deactivation: { status: 'pending', requestedAt: nowIso() } };
    return privacy;
  },
};

export const profileService: ProfileService = selectService({
  fixture: fixtureProfileService,
  http: httpProfileService,
});
