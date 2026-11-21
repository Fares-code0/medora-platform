/**
 * Boundary fixture (RM M2.2) — **this file is supposed to fail lint.**
 *
 * The violation: the same cross-module import written through the `@/`
 * path alias. Without a TypeScript-aware resolver the rule cannot
 * resolve this specifier at all, and a rule that cannot resolve an
 * import skips it silently — so this fixture is really a test of the
 * resolver, not of the zone.
 */
import { PharmacyModule } from '@/modules/pharmacy/pharmacy.module';

export const leakedAlias = PharmacyModule.name;
