import type { ReactNode } from 'react';

import { PHI_ELEVATION_MINUTES } from './phi-access';
import { PhiAccessContext, type PhiAccessValue } from './phi-context';

/**
 * The PHI gate of a production build (RM M40.5).
 *
 * It holds no grants and writes no log, so nothing in the browser — not its
 * memory, not localStorage — can stand as proof that a reveal was authorised.
 * Every identifier stays masked and no reveal is offered: the live API sends
 * admin surfaces no clear identifier to gate (the oversight rows carry the
 * patient's handle only), and a reveal that is authorised and audited
 * server-side for an administrator needs the hospital-scoped contract the
 * Hospital Admin / Platform Admin split (OD-07) requires. Until then the honest
 * answer is "masked", not a client-side grant.
 */
const SERVER_ONLY: PhiAccessValue = {
  canReveal: false,
  isRevealed: () => false,
  grantOf: () => undefined,
  requestReveal: () => undefined,
  hide: () => undefined,
  elevationMinutes: PHI_ELEVATION_MINUTES,
};

export function ServerPhiAccessProvider({ children }: { children: ReactNode }) {
  return <PhiAccessContext.Provider value={SERVER_ONLY}>{children}</PhiAccessContext.Provider>;
}
