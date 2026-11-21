/**
 * Boundary fixture (RM M2.2) — **this file is supposed to fail lint.**
 *
 * The violation: `common/` importing upwards. Everything imports
 * `common/`, so anything it imports is imported by everything —
 * a dependency added here is a dependency added platform-wide.
 */
import { defineStatusMachine } from '../../shared/status';

export const commonLeak = typeof defineStatusMachine;
