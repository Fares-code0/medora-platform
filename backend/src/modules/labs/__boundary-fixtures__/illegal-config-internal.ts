/**
 * Boundary fixture (RM M3.1) — **this file is supposed to fail lint.**
 *
 * The violation: reaching past `config`'s index to `config/env`, the one
 * module that touches `process.env`. A module that can import it can
 * read a raw secret out of the environment, which is exactly what the
 * typed accessors on `ConfigService` exist to prevent.
 */
import { loadEnv } from '../../../config/env';

export const rawSecret = loadEnv().JWT_SECRET;
