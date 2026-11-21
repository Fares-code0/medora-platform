/**
 * Public API — status machines (RM M2.3).
 *
 * Modules import from `shared/status`, never from a file inside it; the
 * `import/no-restricted-paths` zone in `eslint.config.mjs` enforces that.
 */
export { defineStatusMachine, type StatusMachine, type TransitionTable } from './status-machine';
