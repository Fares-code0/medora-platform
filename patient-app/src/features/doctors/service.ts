import { selectService } from '@/api/seam';

import { fixtureDoctorService } from './fixtures/doctor-fixtures';
import { httpDoctorService } from './http-doctor-service';
import type { DoctorService } from './model/types';

/**
 * Doctor discovery.
 *
 * ── This was `unavailableService` until BE-04 landed ─────────────────
 *
 * The previous revision of this file refused every method, because no
 * patient-facing doctor endpoint existed: `GET /doctors` (API §3.4) is
 * the admin roster gated on `can:doctors.manage`, and reusing it would
 * have shipped licence numbers and personal phone numbers to every
 * patient (audit R-3, §7).
 *
 * BE-04 is built. `GET /patient/doctors`, `/patient/doctors/{id}` and
 * `/patient/specialties` are live behind the separate server-side
 * projection ADR-030 §10 specifies, with the verified-and-active-only
 * default enforced on the server where a client cannot turn it off, and
 * a contract test asserting the forbidden fields are absent from the
 * response body.
 *
 * So the swap is the one line the seam was built for. What does NOT swap
 * is `listDepartments` — `GET /patient/departments` is still unbuilt
 * (M23), and `http-doctor-service.ts` refuses that one method by name
 * rather than pretending. A production build still fails loudly there,
 * and now succeeds everywhere else.
 */
export const doctorService: DoctorService = selectService({
  fixture: fixtureDoctorService,
  http: httpDoctorService,
});
