import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../shared/database';

import { PatientController } from './controllers/patient.controller';
import { PatientTabsController } from './controllers/patient-tabs.controller';
import { PatientRepository } from './repositories/patient.repository';
import { PatientTabsRepository } from './repositories/patient-tabs.repository';
import { PatientService } from './services/patient.service';
import { PatientTabsService } from './services/patient-tabs.service';

/**
 * Patients — API §4. M10.
 *
 * Patient identity and the profile bundle the chart screen loads as one
 * payload. **The PHI boundary**: every read here is audited (API §14),
 * and every single-record path goes through `PatientScopeService` —
 * which is M7.2's standing obligation on M9–M14, inherited here first.
 *
 * Built: the care-scoped list with identifier auto-detect (§4.1),
 * registration (§4.2), the detail and profile bundle with their derived
 * fields (§4.3, §4.4, M10.6), the allergy and clinical-alert CRUD that
 * feed the fixed safety strip (§4.5, §4.6 in part, M10.4, M10.5), the
 * update (§4.8) and soft deactivation.
 *
 * **`GET /me/profile` is not here.** It was, at ADR-030; ADR-036 moved
 * it to `UsersModule`, because API §3.1 assigns the same path to the
 * doctor profile document and the composed answer needs a module that
 * can build all three halves. That route is self-scoped through
 * `patients.user_id`; everything in this module is care-scoped through
 * `patient_doctor_assignments`. Two authorization models in one
 * controller is how the wrong one gets applied.
 *
 * The tabs and their child CRUD are `PatientTabsController` — six feeds
 * and four write surfaces that share the `patients/:patientId` prefix
 * and nothing else. Each tab read writes its **own** audit event, which
 * is the reason API §4.5 makes them lazy: one bundle carrying every tab
 * would make every chart open an access to every clinical note on it,
 * and the trail could no longer tell "looked at the summary" from "read
 * the psychiatric history".
 *
 * Document linking and download (§4.7) are on `PatientTabsController`:
 * the bytes go through `POST /files`, the link files them under the
 * chart, and the download checks care scope before M25.3's scan gate.
 * Still M10's own work: the CSV export (§4.10) and the admin governance
 * surface (§4.11, M10.7). `POST /patients/{id}/reveal` (§4.9, M7.3) is on
 * `PatientController`, atomic with its audit row through
 * `TransactionalAuditWriter`.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [PatientController, PatientTabsController],
  providers: [PatientService, PatientRepository, PatientTabsService, PatientTabsRepository],
})
export class PatientsModule {}
