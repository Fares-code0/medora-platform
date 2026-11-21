/**
 * Boundary fixture (RM M3) — **this file is supposed to fail lint.**
 *
 * The violation: configuration importing a domain module. Config is read
 * by everything during bootstrap; a dependency on a module here would
 * make the module's own configuration circular.
 */
import { LabsModule } from '../../modules/labs/labs.module';

export const configLeak = LabsModule.name;
