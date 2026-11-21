import { createContext, useContext } from 'react';

import type { PhiGrant } from './phi-access';

/**
 * The PHI gate's context, apart from either provider that fills it, so that a
 * consumer (`MaskedIdentifier`) depends on the contract and not on the demo
 * provider's audit-log store. Two providers fill it:
 *
 * - `PhiAccessProvider` — the demo build's elevation flow (ADM-10), which logs
 *   each reveal to the seeded administration store before showing anything;
 * - `ServerPhiAccessProvider` — a production build's. It reveals nothing and
 *   records nothing (RM M40.5): the browser is never where a reveal is
 *   authorised or logged. The server's audited reveal (`POST
 *   /patients/{id}/reveal`, M7.3) is the only authority, and its admin
 *   consumer waits on the Hospital Admin / Platform Admin split (OD-07).
 */
export interface PhiAccessValue {
  /** Does this role hold the reveal capability at all? */
  readonly canReveal: boolean;
  readonly isRevealed: (subjectId: string) => boolean;
  readonly grantOf: (subjectId: string) => PhiGrant | undefined;
  /** Opens the justification prompt for one record. */
  readonly requestReveal: (subjectId: string, subjectLabel: string) => void;
  /** Re-masks one record immediately; the log entry stands. */
  readonly hide: (subjectId: string) => void;
  readonly elevationMinutes: number;
}

export const PhiAccessContext = createContext<PhiAccessValue | null>(null);

export function usePhiAccess(): PhiAccessValue {
  const context = useContext(PhiAccessContext);
  if (!context) throw new Error('usePhiAccess must be used within PhiAccessProvider');
  return context;
}
