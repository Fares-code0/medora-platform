/**
 * Global search — API §16.1, RM M26.
 *
 * > ✅ Verify (M26.1): care-scoping holds (no other doctor's patients in
 * > results).
 * > ✅ Verify (M26.2): "backup" finds the Backup settings panel.
 *
 * ## The scope comes from the role, and the parameter cannot widen it
 *
 * `?scope=admin` asks for the administration index; it does not grant
 * it. A doctor sending it gets the doctor scope, and an administrator
 * sending `scope=doctor` gets nothing they could not already see —
 * because the doctor scope is *defined* as "this doctor's own patients",
 * and an administrator holds no care relationship (ADR-022: "only
 * `doctor` can hold one; every other role reaches patient data through
 * the masked projections"). So the admin scope carries no patients at
 * all, which is also what the frontend's own admin index does.
 *
 * That last point is worth stating because it is what keeps this
 * endpoint out of the PHI surface entirely: the only search that returns
 * a patient is one a doctor runs over their own panel, where the clear
 * name and MRN are already what `GET /patients` gives them.
 *
 * ## An empty result is a success
 *
 * Every group is present even when it matched nothing. A client that has
 * to distinguish "no patients matched" from "patients were not searched"
 * cannot do it from a missing key, and the shell's panel says "no
 * matches" about the whole query rather than about a group.
 */

import { Injectable } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { AppException } from '../../../common/errors/app.exception';
import { PatientScopeService, principalOf } from '../../../shared/authz';
import {
  ADMIN_DESTINATIONS,
  DOCTOR_DESTINATIONS,
  type Destination,
  type SearchGroup,
  type SearchResponse,
  type SearchResult,
} from '../dto/search.dto';
import type { SearchQuery, SearchScope } from '../dto/search.schema';
import { SearchRepository } from '../repositories/search.repository';

@Injectable()
export class SearchService {
  constructor(
    private readonly search: SearchRepository,
    private readonly scope: PatientScopeService,
  ) {}

  async run(user: AuthenticatedUser, query: SearchQuery): Promise<SearchResponse> {
    const scope = this.scopeFor(user, query.scope);
    const term = query.q;

    const groups =
      scope === 'admin'
        ? await this.adminGroups(term, query.limit)
        : await this.doctorGroups(user, term, query.limit);

    return {
      query: term,
      scope,
      groups,
      totalItems: groups.reduce((total, group) => total + group.results.length, 0),
    };
  }

  /**
   * The scope this caller may actually search.
   *
   * A role with neither index — a patient account, say — is a **403**
   * rather than an empty result. An empty result would tell them the
   * feature works and found nothing, which is a different and untrue
   * statement; API §16.1's `✓` means authenticated, and this is the one
   * thing beyond authentication the endpoint needs.
   */
  private scopeFor(user: AuthenticatedUser, requested: SearchScope | undefined): SearchScope {
    const available: SearchScope = user.role === 'admin' ? 'admin' : 'doctor';

    if (user.role !== 'admin' && user.role !== 'doctor') {
      throw AppException.forbidden('Search is not available for this account');
    }

    // A requested scope the caller does not hold is ignored, not
    // refused: the parameter is a hint from a shell that knows which
    // index it is rendering, and answering with the caller's own scope
    // is both safe and what they wanted.
    return requested === available ? requested : available;
  }

  /* ── M26.1 — the doctor's own panel ────────────────────────── */

  private async doctorGroups(
    user: AuthenticatedUser,
    term: string,
    limit: number,
  ): Promise<SearchGroup[]> {
    const doctor = await this.scope.clinicalEmployment(principalOf(user));

    // An account with the doctor role but no clinical employment — no
    // `doctors` row, no active employment, unverified, suspended or deleted
    // (S3/S4, #18) — has no patients by construction. The destinations
    // still answer, so the command palette works before the profile does.
    if (doctor === null) {
      return [
        group('patients', 'Patients', []),
        group('appointments', 'Appointments', []),
        group('records', 'Medical records', []),
        group('destinations', 'Go to', matchDestinations(DOCTOR_DESTINATIONS, term, limit)),
      ];
    }

    const [patients, appointments, records] = await Promise.all([
      this.search.patients(doctor, term, limit),
      this.search.appointments(doctor, term, limit),
      this.search.records(doctor, term, limit),
    ]);

    return [
      group(
        'patients',
        'Patients',
        patients.map((hit) => ({
          id: `patient-${hit.publicId}`,
          label: hit.fullName,
          // The clear MRN, which is what this doctor already sees on
          // `GET /patients` for a patient on their own panel. An MRN is
          // what a clinician reads off a wristband, and masking it here
          // while showing it one route away would protect nothing.
          hint: `Patient · MRN ${hit.mrn}`,
          section: 'patients',
          path: `/doctor/patients/${hit.publicId}`,
        })),
      ),
      group(
        'appointments',
        'Appointments',
        appointments.map((hit) => ({
          id: `appointment-${hit.publicId}`,
          label: `${hit.patient.fullName} — ${hit.reason}`,
          hint: `Appointment · ${hit.startsAt.toISOString().slice(0, 10)}`,
          section: 'appointments',
          path: `/doctor/appointments/${hit.publicId}`,
        })),
      ),
      group(
        'records',
        'Medical records',
        records.map((hit) => ({
          id: `record-${hit.publicId}`,
          label: `${hit.patient.fullName} — ${hit.visitType}`,
          hint: `Record · ${hit.visitDate.toISOString().slice(0, 10)}`,
          section: 'records',
          path: `/doctor/medical-records/${hit.publicId}`,
        })),
      ),
      group('destinations', 'Go to', matchDestinations(DOCTOR_DESTINATIONS, term, limit)),
    ];
  }

  /* ── M26.2 — the administration index ──────────────────────── */

  private async adminGroups(term: string, limit: number): Promise<SearchGroup[]> {
    const [staff, departments, rooms, resources, announcements, policies, templates] =
      await Promise.all([
        this.search.staff(term, limit),
        this.search.departments(term, limit),
        this.search.rooms(term, limit),
        this.search.resources(term, limit),
        this.search.announcements(term, limit),
        this.search.policies(term, limit),
        this.search.templates(term, limit),
      ]);

    return [
      named('staff', 'Staff', 'staff', staff),
      named('departments', 'Departments', 'departments', departments),
      named('rooms', 'Rooms', 'rooms', rooms),
      named('resources', 'Resources', 'resources', resources),
      named('announcements', 'Announcements', 'announcements', announcements),
      named('policies', 'Policies', 'policies', policies),
      named('templates', 'Templates', 'templates', templates),
      // Settings panels and sections. M26.2's verify step — `"backup"`
      // finds the Backup panel — lands here, and it is why the
      // destinations are indexed at all: a panel is a page, not a row.
      group('destinations', 'Go to', matchDestinations(ADMIN_DESTINATIONS, term, limit)),
    ];
  }
}

function group(key: string, label: string, results: readonly SearchResult[]): SearchGroup {
  return { key, label, results };
}

/** An administration entity group, all of which share one row shape. */
function named(
  key: string,
  label: string,
  section: string,
  hits: readonly { id: string; name: string; detail: string }[],
): SearchGroup {
  return {
    key,
    label,
    results: hits.map((hit) => ({
      id: `${key}-${hit.id}`,
      label: hit.name,
      // `<kind> · <section>`, which is the hint shape both client-side
      // indexes already render.
      hint: `${hit.detail} · ${label}`,
      section,
      path: `/admin/${section}`,
    })),
  };
}

/**
 * Destinations are matched in memory, and that is not a shortcut.
 *
 * There are forty of them, they are a compile-time constant, and they
 * change when the shell's navigation changes rather than when the clinic
 * does. A table would have to be seeded and kept in step with
 * `routes/index.ts` — a second source of truth for the same list, which
 * is the drift the parity spec exists to prevent.
 */
function matchDestinations(
  destinations: readonly Destination[],
  term: string,
  limit: number,
): SearchResult[] {
  const query = term.toLowerCase();

  return destinations
    .filter(
      (destination) =>
        destination.label.toLowerCase().includes(query) ||
        destination.hint.toLowerCase().includes(query),
    )
    .slice(0, limit)
    .map((destination) => ({
      id: destination.id,
      label: destination.label,
      hint: destination.hint,
      section: destination.section,
      path: destination.path,
    }));
}
