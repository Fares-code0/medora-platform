import { Controller, Get, Query } from '@nestjs/common';

import { RevalidatePrivately } from '../../../common/http/cache-policy';
import { zodQuery } from '../../../common/validation/zod-validation.pipe';
import { Can, NotPhi } from '../../../shared/authz';
import { labTestListSchema, type LabTestListQuery } from '../dto/lab-test.schema';
import { LabTestService, type PaginatedLabTests } from '../services/lab-test.service';

/**
 * The test catalogue (RM M14.1 — API §8.1).
 *
 * ## `labs.review` guards a read route, and it is the only lab capability
 *
 * The contract marks §8.1 `doctor`. The 22-permission union
 * (`permission-catalogue.ts`) has exactly one laboratory capability —
 * `labs.review` — held by the `doctor` and `laboratory` bundles and by
 * neither `admin`, `reception` nor `pharmacy`. Guarding the catalogue
 * with it is the same move `MedicationController` makes with
 * `prescriptions.create`: the capability that expresses "works with
 * laboratory results" is the honest gate, and it lands on precisely the
 * two roles §8 addresses.
 *
 * The alternative, a bare `@Authenticated()`, would make the catalogue
 * readable by every signed-in account including patients, which is a
 * disclosure with no upside — nothing in the patient app orders a test.
 *
 * Reference data, so no care scope: see `lab-test.service.ts`.
 */
@Can('labs.review')
@Controller('lab-tests')
export class LabTestController {
  constructor(private readonly tests: LabTestService) {}

  /** API §8.1 — code, name, category and the analyte specs. */
  @NotPhi('lab test reference catalogue')
  @Get('catalogue')
  @RevalidatePrivately()
  catalogue(
    @Query(zodQuery(labTestListSchema)) query: LabTestListQuery,
  ): Promise<PaginatedLabTests> {
    return this.tests.catalogue(query);
  }
}
