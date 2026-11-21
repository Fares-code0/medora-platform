import { accountEndpoints } from '@/api/endpoints/account';
import { profileEndpoints, type WireProfile } from '@/api/endpoints/profile';
import { sessionEndpoints, type WireActiveSession } from '@/api/endpoints/sessions';
import { EndpointNotImplementedError } from '@/api/seam';

import type {
  ActiveSession,
  PatientProfile,
  PrivacyState,
  ProfileField,
  ProfileFieldId,
  ProfileService,
} from './model/types';

/**
 * The HTTP adapter for the patient profile — checklist P-01.
 *
 * ── Three live routes, four refusals ─────────────────────────────────
 *
 * `GET /me/profile`, `GET /me/sessions` and `DELETE /me/sessions/{id}`
 * are live. `update` is blocked by **RA-030.2** — the editable field set
 * is a data-ownership policy nobody has decided — and the three privacy
 * methods by the absence of any route that serves them.
 *
 * The blockers are named separately rather than lumped together because
 * they are different kinds of missing: one is a decision, the others are
 * unbuilt routes. A reviewer reading a refusal should be able to tell
 * which.
 *
 * ── The sessions pair used to refuse, and the reason expired ─────────
 *
 * Both said `BE-10 / M8`: the users-and-account milestone that would
 * expose them was unbuilt. **M8 has since landed**, and with it
 * `account-security.controller.ts` — so the refusal was answering a
 * question that had stopped being true. This is the swap the seam exists
 * for and it is the whole change: `SecurityScreen` already rendered the
 * list, already guarded the current row, already confirmed before
 * revoking. Nothing above the port moved.
 *
 * Note what did **not** swap with it. `/me/devices` and
 * `/me/login-history` landed in the same controller and are not read
 * here: neither is on this port, and adding a trusted-device list and a
 * sign-in history to a patient's screen is a product decision rather
 * than an adapter's. A service is allowed to be live in two methods and
 * silent about a third route it can see.
 *
 * ── `editable` is a fact here, not a policy claim ────────────────────
 *
 * The port documents `editable` as server-supplied, and the live
 * response carries no such flag. That looks like the `availableActions`
 * problem from the appointments adapter, and it is not.
 *
 * `availableActions: []` would assert *the server says no action is
 * permitted* — a policy statement while ADR-033 is open. `editable`
 * asserts *this field can or cannot be edited right now*, which is a
 * question about which routes exist and is answerable:
 *
 * - **`phone` is `true`.** `PATCH /me/account` writes `users.phone`
 *   (API §2.2, live since M8) and `account.controller.ts` names patients
 *   as its audience — a `@Can(...)` there *"would deny patients, who
 *   hold zero capabilities (ADR-030 §6) and who have an account settings
 *   screen like anyone else."*
 * - **Everything else is `false`.** `fullName`, `dateOfBirth`,
 *   `bloodType` and `address` are the clinical record's, and which of
 *   them a patient may change is exactly RA-030.2 — undecided, and not
 *   this adapter's to decide. `email` is read-only for a different and
 *   firmer reason: `updateAccountSchema` excludes it on purpose, because
 *   moving a sign-in address needs a verify-and-notify flow that does
 *   not exist.
 *
 * So the split is drawn along **which table the field lives in**, not
 * along a list of fields this client thinks a patient should own.
 *
 * ── `patient: null` is a first-class state ───────────────────────────
 *
 * An account with no clinical record is the normal state right after
 * signup. The clinical fields render with a `null` value and the profile
 * reports `linkedToClinicalRecord: false`, which is what
 * `ProfileScreen`'s warning badge already renders. It is never an error,
 * and it must never trigger a logout.
 */

const CLINIC = 'Your clinic';
const ACCOUNT = 'Your account';

function fieldsFrom(wire: WireProfile): readonly ProfileField[] {
  const { account, patient } = wire;
  return [
    {
      id: 'fullName',
      label: 'Full name',
      // The clinical record's name is the one a clinician sees. Falling
      // back to the account's display name keeps the row populated for
      // an unlinked account without implying a record exists.
      value: patient?.fullName ?? account.displayName,
      editable: false,
      ownedBy: patient === null ? ACCOUNT : CLINIC,
    },
    {
      id: 'dateOfBirth',
      label: 'Date of birth',
      value: patient?.dateOfBirth ?? null,
      editable: false,
      ownedBy: CLINIC,
    },
    {
      id: 'bloodType',
      label: 'Blood type',
      value: patient?.bloodType ?? null,
      editable: false,
      ownedBy: CLINIC,
    },
    {
      id: 'email',
      label: 'Email',
      // The ACCOUNT's email, not the record's: this is the address the
      // patient signs in with and the one they would change. The record
      // carries the clinic's copy, which may differ and is the clinic's
      // to correct.
      value: account.email,
      editable: false,
      ownedBy: ACCOUNT,
    },
    {
      id: 'phone',
      // The ACCOUNT's phone, and the one field on this document a
      // patient owns outright. `PATCH /me/account` writes it (API §2.2).
      // The clinic's copy lives on the clinical record and is the
      // clinic's to correct — see the header.
      label: 'Phone',
      value: account.phone === '' ? null : account.phone,
      editable: true,
      ownedBy: ACCOUNT,
    },
    {
      id: 'address',
      label: 'Address',
      value: patient?.address ?? null,
      editable: false,
      ownedBy: CLINIC,
    },
  ];
}

function toProfile(wire: WireProfile): PatientProfile {
  return {
    displayName: wire.account.displayName,
    // The record's photo when there is a record, the account's avatar
    // otherwise. Neither is invented when both are absent.
    photoUrl: wire.patient?.photoUrl ?? wire.account.avatarUrl,
    fields: fieldsFrom(wire),
    linkedToClinicalRecord: wire.patient !== null,
  };
}

/**
 * The wire session, narrowed to what the screen answers a question with.
 *
 * `device` first and `browser` second because the patient is being asked
 * *do I recognise this*: "Pixel 7" identifies a thing someone owns and
 * "Chrome" identifies a thing everyone has. Neither is guaranteed, and
 * when both are absent the label is `null` rather than a guess — see the
 * port's note on why the absence travels instead of being papered over
 * with an English string here.
 */
function toActiveSession(wire: WireActiveSession): ActiveSession {
  return {
    id: wire.id,
    deviceLabel: wire.device ?? wire.browser,
    lastSeenAt: wire.lastActiveAt,
    current: wire.current,
  };
}

export const httpProfileService: ProfileService = {
  async get(): Promise<PatientProfile> {
    const response = await profileEndpoints.get();
    return toProfile(response.data);
  },

  /**
   * Writes the one field a patient owns, and refuses the rest by name.
   *
   * `PATCH /me/account` (API §2.2) takes the account's phone.
   * `PATCH /me/profile` is the *clinical* edit — contract §2 P2.2,
   * blocked by RA-030.2 — and answers 404 for an account with no
   * `doctors` row in any case, so a clinical field in `values` is
   * refused here rather than sent somewhere it cannot go.
   *
   * A call carrying nothing editable refuses too, rather than resolving
   * quietly: a save that reports success having sent no request is how a
   * patient comes to believe a correction was recorded.
   *
   * The profile is **re-read** rather than patched from the response.
   * `AccountView` carries neither `displayName` nor the clinical half,
   * so it cannot rebuild this document — and re-reading is this tree's
   * standing rule for a write anyway.
   */
  async update(values: Partial<Record<ProfileFieldId, string>>): Promise<PatientProfile> {
    const requested = Object.keys(values) as ProfileFieldId[];
    const clinical = requested.filter((id) => id !== 'phone');

    if (clinical.length > 0) {
      return Promise.reject(new EndpointNotImplementedError('RA-030.2', 'capability.profileEdit'));
    }

    const phone = values.phone;
    if (phone === undefined) {
      return Promise.reject(new EndpointNotImplementedError('RA-030.2', 'capability.profileEdit'));
    }

    await accountEndpoints.updateAccount({ phone });
    return this.get();
  },

  /** `GET /me/sessions` — API §2.4, live since M8. */
  async listSessions(): Promise<readonly ActiveSession[]> {
    const response = await sessionEndpoints.list();
    return response.data.map(toActiveSession);
  },

  /**
   * `DELETE /me/sessions/{id}` — API §2.5, 204.
   *
   * The current session is **not** refused here, and that is deliberate.
   * `SecurityScreen` never offers the control on the row it marks
   * `current`, and the fixture refuses it so a development build behaves
   * like the route; but a client-side guard in front of a server-side
   * rule is a second place for that rule to live. The server owns which
   * sessions a caller may end, and this adapter asks it.
   */
  async revokeSession(id: string): Promise<void> {
    await sessionEndpoints.revoke(id);
  },

  /**
   * The two privacy requests (P-09, P-10) have **no route at all**.
   *
   * They used to be attributed to BE-10 / M8, and that attribution has
   * expired: M8 landed, and what it shipped is the account document, the
   * activity feed, sessions, devices and sign-in history. A data-export
   * job and an account-closure request are in none of it, and neither is
   * in the contract's §2 surface. So the blocker is no longer "the module
   * is unbuilt" — it is that these two routes are **unspecified**, which
   * is a different thing to be waiting for and is named as such.
   *
   * Deliberately **not** given a `BE-nn` code. The audit §15.3 register
   * runs to BE-17 and none of its rows is this work — BE-14 is the
   * patient AI surface — so minting a new one here would put an
   * identifier in the code that the register it points at does not
   * define. The string is developer-facing (only `capability` reaches a
   * screen), so it can say what is true instead.
   *
   * They stay separate from one another because a patient reading "not
   * available yet" on a data-export screen is being told something
   * different from a patient reading it about account closure, and the
   * capability string is what they see.
   */
  getPrivacyState(): Promise<PrivacyState> {
    return Promise.reject(new EndpointNotImplementedError('unspecified (API §2)', 'capability.privacyRequests'));
  },

  requestDataExport(): Promise<PrivacyState> {
    return Promise.reject(new EndpointNotImplementedError('unspecified (API §2)', 'capability.dataExport'));
  },

  requestDeactivation(): Promise<PrivacyState> {
    return Promise.reject(new EndpointNotImplementedError('unspecified (API §2)', 'capability.accountClosure'));
  },
};
