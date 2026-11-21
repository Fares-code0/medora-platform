/**
 * Boundary fixture (RM M2.3) — **this file is supposed to fail lint.**
 *
 * The violation: the shared kernel importing a domain module. The
 * kernel exists to break cycles between modules; a kernel that depends
 * on one of them has reintroduced the cycle at the bottom of the stack.
 */
import { LabsModule } from '../../modules/labs/labs.module';

export const kernelLeak = LabsModule.name;
