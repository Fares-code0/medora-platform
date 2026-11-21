import { apiClient } from '@/api/client';
import {
  asRecord,
  malformedResponse,
  readOptionalString,
  readPage,
  readString,
} from '@/api/http';
import { createKeyFactory } from '@/api/query-keys';
import { selectService } from '@/api/seam';
import { MOCK_PATIENTS } from '@/features/shared-domain/patient-identity';
import { maskDateOfBirth, maskMrn, maskName, maskPhone } from '@/utils/phi-mask';

/**
 * The masked patient directory (DEC-006a) — `GET /patients` as a
 * non-practitioner sees it.
 *
 * The server decides the projection, not this client: an account with no
 * `doctors` row gets `MaskedIdentity` rows (`backend/src/shared/phi`), whose
 * fields can only hold masked values. Nothing here unmasks, and there is no
 * reveal — none of the staff roles holds `patients.revealIdentity`. A row
 * that arrives with `revealed !== false` is refused as malformed rather than
 * shown, so a server change can never turn this list into a clear one by
 * accident.
 */

export interface MaskedPatient {
  readonly patientId: string;
  readonly name: string;
  readonly mrn: string;
  readonly phone: string | null;
  readonly dateOfBirth: string | null;
}

export interface MaskedDirectoryPage {
  readonly items: readonly MaskedPatient[];
  readonly page: number;
  readonly totalPages: number;
  readonly totalItems: number;
}

export interface MaskedDirectoryQuery {
  readonly q: string;
  readonly page: number;
}

export interface MaskedDirectoryService {
  list(query: MaskedDirectoryQuery): Promise<MaskedDirectoryPage>;
}

export const DIRECTORY_PAGE_SIZE = 25;

export const staffDirectoryKeys = createKeyFactory('staff-directory');

function toMaskedPatient(value: unknown): MaskedPatient {
  const what = 'masked patient';
  const dto = asRecord(value, what);
  // The directory must never render a clear identity, whatever the server sends.
  if (dto.revealed !== false) throw malformedResponse(what);
  return {
    patientId: readString(dto, 'patientId', what),
    name: readString(dto, 'name', what),
    mrn: readString(dto, 'mrn', what),
    phone: readOptionalString(dto, 'phone', what),
    dateOfBirth: readOptionalString(dto, 'dateOfBirth', what),
  };
}

export const httpMaskedDirectoryService: MaskedDirectoryService = {
  async list({ q, page }) {
    const query = q.trim();
    const result = readPage(
      await apiClient.get('/patients', {
        page,
        pageSize: DIRECTORY_PAGE_SIZE,
        ...(query === '' ? {} : { q: query }),
      }),
      'patient directory',
    );
    return {
      items: result.items.map(toMaskedPatient),
      page: result.page,
      totalPages: result.totalPages,
      totalItems: result.totalItems,
    };
  },
};

const MOCK_LATENCY_MS = 300;

/**
 * The demo twin: the seeded roster, searched on its clear values as the
 * server searches, then masked with `utils/phi-mask` — the maskers the
 * backend's own parity spec holds to `shared/phi`.
 */
export const mockMaskedDirectoryService: MaskedDirectoryService = {
  async list({ q, page }) {
    await new Promise((resolve) => setTimeout(resolve, MOCK_LATENCY_MS));
    const needle = q.trim().toLowerCase();
    const matches = MOCK_PATIENTS.filter(
      (patient) =>
        needle === '' ||
        patient.name.toLowerCase().includes(needle) ||
        patient.mrn.toLowerCase().includes(needle) ||
        patient.id.toLowerCase().includes(needle),
    );
    const totalPages = Math.max(1, Math.ceil(matches.length / DIRECTORY_PAGE_SIZE));
    const start = (page - 1) * DIRECTORY_PAGE_SIZE;
    return {
      items: matches.slice(start, start + DIRECTORY_PAGE_SIZE).map((patient) => ({
        patientId: patient.id,
        name: maskName(patient.name),
        mrn: maskMrn(patient.mrn),
        phone: maskPhone(patient.phone),
        dateOfBirth: maskDateOfBirth(patient.dateOfBirth),
      })),
      page,
      totalPages,
      totalItems: matches.length,
    };
  },
};

export const maskedDirectoryService = selectService({
  mock: mockMaskedDirectoryService,
  http: httpMaskedDirectoryService,
});
