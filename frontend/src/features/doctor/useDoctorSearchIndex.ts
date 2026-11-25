import { useCallback, useMemo, useState } from 'react';

import { useCan } from '@/app/providers';
import { useT } from '@/i18n';
import type { ShellSearchResult, ShellSearchValue } from '@/layouts';
import { doctorNavigation } from '@/layouts';
import { routes } from '@/routes';
import { formatDate } from '@/utils/dates';

import { useAppointmentsQuery } from './appointments/api/useAppointmentsQuery';
import { useLabTestsQuery } from './labs/api/useLabTestsQuery';
import { useMedicalRecordsQuery } from './medical-records/api/useMedicalRecordsQuery';
import { usePatientsQuery } from './patients/api/usePatientsQuery';
import { usePrescriptionsQuery } from './pharmacy/api/usePrescriptionsQuery';
import { SETTINGS_SECTIONS } from './settings/model/types';

/**
 * The doctor workspace's search index — D-26.
 *
 * **What was wrong.** `GlobalSearch` has had a panel, a query and
 * navigation since Phase B, but it reads `ShellSearchContext`, and only the
 * admin shell ever mounted a provider. On every doctor page the context fell
 * back to its default `search: () => []`, so typing a patient's name opened a
 * panel that said **"No matches for 'Khaled'"** — about a patient sitting in
 * the roster two routes away. Not a dead input, as the checklist row had it:
 * a confidently wrong one, which is worse, and the same defect class as the
 * Documents tab's fabricated PDF (D-04).
 *
 * **What it indexes, and why those three.** The navbar's own placeholder has
 * always read *"Search patients, appointments, records…"* — the field made a
 * promise the app never kept. So the index is built from exactly those three,
 * plus the destinations that make `Ctrl+K` a command palette rather than only
 * a lookup:
 *
 *  · **Patients** — matched on name, MRN and id, because an MRN is what a
 *    doctor reads off a wristband or a requisition and it is not on screen
 *    to copy from.
 *  · **Appointments** and **medical records** — matched on the patient's
 *    name and MRN as well as their own text, since "Khaled" is how a
 *    clinician looks for last Tuesday's encounter, not by record id.
 *  · **Destinations** — every sidebar item and every settings section,
 *    permission-gated through the same `requiredPermission` the sidebar
 *    honours, so search can never route someone to a page the nav is
 *    deliberately hiding from them.
 *
 * **It reads queries, not the seed modules.** `usePatientsQuery` is a session
 * store, so a patient added through "Add patient" is findable immediately;
 * reading `MOCK_PATIENTS` directly would have indexed the roster the app
 * started with and quietly missed every patient created since. The three
 * hooks share the cache with the pages that own them, so mounting this at the
 * shell warms them rather than duplicating them.
 *
 * Lab orders and prescriptions are indexed too (ported from #63, so a
 * patient's name surfaces the rest of their chart). Over HTTP the lab
 * worklist is one GET per order, so its observer here opts out of the focus
 * refetch; it is still fetched once, on first activation.
 */

/**
 * Index order AND interleave order. A patient outranks their own encounters
 * on an equal match, and destinations come last because a doctor typing a
 * name wants the person, not the page.
 */
const DOMAINS = ['patient', 'appointment', 'lab', 'prescription', 'record', 'destination'] as const;

type Domain = (typeof DOMAINS)[number];

/**
 * How many of one domain may occupy the head of the results.
 *
 * Ported from the parallel D-26 implementation in #63, which found this in a
 * browser: searching a patient's name returned the patient and then five of
 * that patient's own appointments — six of the navbar's seven slots spent
 * saying the same thing, while their labs, prescriptions and records never
 * appeared. My own browser run showed the identical output and I read past
 * it. Nothing is dropped; a sixth appointment simply belongs behind a lab
 * result for the same patient that has not been shown yet.
 */
const HEAD_PER_DOMAIN = 3;

/** Ranked by how well a term matched, best first. */
const RANK_PREFIX = 0;
const RANK_WORD = 1;
const RANK_CONTAINS = 2;
const RANK_NONE = 3;

/** Searchable strings carried beside the shell's display shape. */
export interface IndexEntry {
  readonly result: ShellSearchResult;
  /** Lowercased. Matched in order, so the primary field ranks first. */
  readonly terms: readonly string[];
  readonly domain: Domain;
}

function rankTerm(term: string, query: string): number {
  const at = term.indexOf(query);
  if (at === -1) return RANK_NONE;
  if (at === 0) return RANK_PREFIX;
  // A match that starts a word beats one buried mid-token, so "ali" finds
  // "Nour Ali" ahead of "Khaled Alialdin".
  return term[at - 1] === ' ' || term[at - 1] === '-' ? RANK_WORD : RANK_CONTAINS;
}

/**
 * How well an entry matched, and how much of the matched term the query
 * covered. The second half is the tie-break, and it is not cosmetic: "lab"
 * is a prefix of both the Labs destination and a "Lab review" appointment,
 * and without it the appointment wins on index order alone — so typing the
 * name of a sidebar section would fail to offer that section. A prefix that
 * consumes most of the term is the tighter match.
 */
interface EntryRank {
  readonly rank: number;
  readonly matchedLength: number;
}

function rankEntry(entry: IndexEntry, query: string): EntryRank {
  let best = RANK_NONE;
  let matchedLength = Number.MAX_SAFE_INTEGER;
  for (const term of entry.terms) {
    const rank = rankTerm(term, query);
    if (rank < best || (rank === best && term.length < matchedLength)) {
      if (rank < best) matchedLength = term.length;
      else matchedLength = Math.min(matchedLength, term.length);
      best = rank;
    }
  }
  return { rank: best, matchedLength };
}

const DOMAIN_ORDER: Readonly<Record<Domain, number>> = {
  patient: 0,
  appointment: 1,
  lab: 2,
  prescription: 3,
  record: 4,
  destination: 5,
};

interface Ranked {
  readonly entry: IndexEntry;
  readonly rank: EntryRank;
  readonly order: number;
}

/**
 * The index, matched and ordered for `term`. Pure, so the shell can call it
 * on every keystroke over a doctor's whole caseload.
 */
export function searchIndex(
  index: readonly IndexEntry[],
  term: string,
): readonly ShellSearchResult[] {
  const query = term.trim().toLowerCase();
  if (query.length === 0) return [];

  const ranked: Ranked[] = [];
  index.forEach((entry, order) => {
    const rank = rankEntry(entry, query);
    if (rank.rank !== RANK_NONE) ranked.push({ entry, rank, order });
  });

  // The shell shows only the first seven, so ranking is not cosmetic — an
  // exact patient-name match must not be pushed off the panel by the
  // appointments that happen to mention them. Index order is the last
  // tie-break, which is why patients are pushed first.
  ranked.sort((a, b) => {
    if (a.rank.rank !== b.rank.rank) return a.rank.rank - b.rank.rank;
    if (a.rank.matchedLength !== b.rank.matchedLength) {
      return a.rank.matchedLength - b.rank.matchedLength;
    }
    return a.order - b.order;
  });

  /*
   * Interleave equally-ranked results across domains, then cap how much
   * of the head any one domain may take. Sorting alone is not enough:
   * a patient and five of their appointments are ALL prefix matches on
   * the same name, so they sit in one band, the patient's lane empties
   * after one item, and the rest of the panel goes to appointments —
   * which is what both browser runs of this feature actually showed.
   *
   * Round-robin happens strictly WITHIN a band, never across one, so a
   * better match still beats a worse one and only genuine ties spread.
   *
   * A band is `rank` AND `matchedLength`, not rank alone. Keying on rank
   * by itself discards the tightness tie-break and lets a domain earlier
   * in `DOMAINS` win a comparison it had already lost: "lab" put a "Lab
   * review" APPOINTMENT above the Labs destination, because both are
   * prefix matches and appointments sort first. Two tests caught it —
   * including the one written for that exact tie-break the first time
   * round.
   *
   * The sort keys on rank and then matchedLength, so each band is one
   * contiguous run of `ranked`, in band order. Walking those runs once is
   * linear; it used to rescan the whole list per band (bands × matches,
   * building a string key per item), on every keystroke.
   */
  const interleaved: Ranked[] = [];
  let start = 0;
  while (start < ranked.length) {
    const first = ranked[start] as Ranked;
    const lanes: Ranked[][] = DOMAINS.map(() => []);
    let end = start;
    for (; end < ranked.length; end += 1) {
      const item = ranked[end] as Ranked;
      if (
        item.rank.rank !== first.rank.rank ||
        item.rank.matchedLength !== first.rank.matchedLength
      ) {
        break;
      }
      (lanes[DOMAIN_ORDER[item.entry.domain]] as Ranked[]).push(item);
    }
    const ordered = lanes.filter((lane) => lane.length > 0);
    const deepest = Math.max(...ordered.map((lane) => lane.length));
    for (let depth = 0; depth < deepest; depth += 1) {
      for (const lane of ordered) {
        const item = lane[depth];
        if (item) interleaved.push(item);
      }
    }
    start = end;
  }

  // Nothing is dropped — the overflow is deferred, not discarded, so a
  // caller that wants everything still gets everything.
  const head: Ranked[] = [];
  const tail: Ranked[] = [];
  const seen = new Map<Domain, number>();
  for (const item of interleaved) {
    const count = seen.get(item.entry.domain) ?? 0;
    seen.set(item.entry.domain, count + 1);
    (count < HEAD_PER_DOMAIN ? head : tail).push(item);
  }

  return [...head, ...tail].map(({ entry }) => entry.result);
}

export function useDoctorSearchIndex(): ShellSearchValue {
  const can = useCan();
  const t = useT();
  /*
   * Nothing is fetched until the field is engaged (D-26, ported from #63).
   * Five datasets behind mock latency on every doctor page load is five
   * round trips spent on a control most page views never touch — and the
   * shell mounts this on every one of them. `onActivate` latches: once a
   * doctor has used search this session, the index stays warm.
   */
  const [activated, setActivated] = useState(false);
  const enabled = { enabled: activated };

  const patients = usePatientsQuery(enabled);
  const appointments = useAppointmentsQuery(enabled);
  const records = useMedicalRecordsQuery(enabled);
  const labs = useLabTestsQuery({ ...enabled, refetchOnWindowFocus: false });
  const prescriptions = usePrescriptionsQuery(enabled);

  const index = useMemo<readonly IndexEntry[]>(() => {
    const entries: IndexEntry[] = [];

    const push = (domain: Domain, result: ShellSearchResult, terms: readonly string[]) => {
      entries.push({ result, domain, terms: terms.map((term) => term.toLowerCase()) });
    };

    // Order is the tie-break when two entries match equally well: a patient
    // outranks their own appointments, which outrank their records.
    for (const patient of patients.data ?? []) {
      push(
        'patient',
        {
          id: `patient-${patient.id}`,
          label: patient.name,
          hint: `Patient · MRN ${patient.mrn}`,
          path: routes.doctor.patient(patient.id),
        },
        [patient.name, patient.mrn, patient.id],
      );
    }

    for (const appointment of appointments.data ?? []) {
      push(
        'appointment',
        {
          id: `appointment-${appointment.id}`,
          label: `${appointment.patient.name} — ${appointment.visitType}`,
          hint: `Appointment · ${formatDate(appointment.dateTime)}`,
          path: routes.doctor.appointment(appointment.id),
        },
        [
          appointment.patient.name,
          appointment.patient.mrn,
          appointment.visitType,
          appointment.reason,
          appointment.id,
        ],
      );
    }

    for (const record of records.data ?? []) {
      push(
        'record',
        {
          id: `record-${record.id}`,
          label: `${record.patient.name} — ${record.visitType}`,
          hint: `Record · ${formatDate(record.visitDate)}`,
          path: routes.doctor.medicalRecord(record.id),
        },
        [
          record.patient.name,
          record.patient.mrn,
          record.visitType,
          record.chiefComplaint,
          record.id,
        ],
      );
    }

    for (const lab of labs.data ?? []) {
      push(
        'lab',
        {
          id: `lab-${lab.id}`,
          label: `${lab.patient.name} — ${lab.testName}`,
          hint: `Lab · ${lab.testCode}`,
          path: routes.doctor.labReport(lab.id),
        },
        [lab.patient.name, lab.patient.mrn, lab.testName, lab.testCode, lab.id],
      );
    }

    for (const prescription of prescriptions.data ?? []) {
      push(
        'prescription',
        {
          id: `prescription-${prescription.id}`,
          label: `${prescription.patient.name} — ${prescription.medication.name}`,
          hint: `Prescription · ${prescription.dosage}`,
          path: routes.doctor.prescription(prescription.id),
        },
        [
          prescription.patient.name,
          prescription.patient.mrn,
          prescription.medication.name,
          prescription.medication.genericName,
          prescription.id,
        ],
      );
    }

    for (const section of doctorNavigation.sections) {
      for (const item of section.items) {
        // The same gate the sidebar applies. Search must not be a back door
        // to a destination the nav is withholding.
        if (item.requiredPermission !== undefined && !can(item.requiredPermission)) continue;
        push(
          'destination',
          {
            id: `nav-${item.id}`,
            label: t(item.labelKey),
            hint:
              section.labelKey === undefined ? 'Go to' : `Go to · ${t(section.labelKey)}`,
            path: item.path,
          },
          [t(item.labelKey)],
        );
      }
    }

    for (const section of SETTINGS_SECTIONS) {
      push(
        'destination',
        {
          id: `settings-${section.id}`,
          label: section.label,
          hint: `Settings · ${section.group}`,
          path: routes.doctor.settings(section.id),
        },
        [`${section.label} settings`, section.label],
      );
    }

    return entries;
  }, [patients.data, appointments.data, records.data, labs.data, prescriptions.data, can, t]);

  const search = useCallback(
    (term: string): readonly ShellSearchResult[] => searchIndex(index, term),
    [index],
  );

  const onActivate = useCallback(() => {
    setActivated(true);
  }, []);

  return useMemo(
    () => ({
      search,
      onActivate,
      // Only "pending" once activated: an index nobody has asked for is idle,
      // not loading, and the panel cannot be open to claim either.
      pending:
        activated &&
        (patients.isPending ||
          appointments.isPending ||
          records.isPending ||
          labs.isPending ||
          prescriptions.isPending),
    }),
    [
      search,
      onActivate,
      activated,
      patients.isPending,
      appointments.isPending,
      records.isPending,
      labs.isPending,
      prescriptions.isPending,
    ],
  );
}
