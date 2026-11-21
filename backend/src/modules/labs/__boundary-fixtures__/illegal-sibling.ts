/**
 * Boundary fixture (RM M2.2) — **this file is supposed to fail lint.**
 *
 * `test/boundaries.e2e-spec.ts` lints this folder deliberately and
 * asserts the rule rejects it. `eslint .` ignores the folder, so the
 * normal quality gate stays green.
 *
 * The violation: one domain module importing a sibling.
 */
import { PharmacyModule } from '../../pharmacy/pharmacy.module';

export const leaked = PharmacyModule.name;
