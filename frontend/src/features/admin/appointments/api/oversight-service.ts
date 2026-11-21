import type { OversightSummary } from '../oversight.types';

import type { CancelInput, NudgeInput, OversightDocument, ReassignInput } from './oversight.api';

/**
 * Appointment oversight — the port (ADM-05, FE-10.10).
 *
 * Two adapters: the demo store (`oversight.api.ts`) and the HTTP adapter
 * over API §5.10–5.11 (`../http/http-oversight-service.ts`), picked once in
 * `service.ts`.
 *
 * As in doctors management, a write answers with the patched demo document
 * or with `null` — the live API returns one updated row, not the book — and
 * `null` means the query layer re-reads the book and the KPI strip.
 */
export interface OversightCapabilities {
  /**
   * Each appointment's event history and notification receipts. The live
   * oversight row carries neither, so the drawer says so instead of drawing
   * an empty history that would read as "nothing ever happened".
   */
  readonly history: boolean;
}

export type OversightWrite = Promise<OversightDocument | null>;

export interface OversightService {
  readonly capabilities: OversightCapabilities;
  /** Every doctor's appointments, and the roster a reassignment picks from. */
  list(): Promise<OversightDocument>;
  /** The KPI strip — the server's own counts where there is a server. */
  summary(): Promise<OversightSummary>;
  nudge(input: NudgeInput): OversightWrite;
  reassign(input: ReassignInput): OversightWrite;
  cancelAdministratively(input: CancelInput): OversightWrite;
}
