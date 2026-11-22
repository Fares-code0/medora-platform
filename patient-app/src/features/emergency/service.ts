import { selectService } from '@/api/seam';

import { UNCONFIGURED_EMERGENCY, type EmergencyService } from './model/types';

/**
 * The emergency configuration service.
 *
 * Both adapters return `UNCONFIGURED_EMERGENCY` today, and that is the
 * honest state of the world rather than a stub waiting to be filled in:
 *
 * - The **fixture** adapter returns nothing because inventing a number for
 *   a development build is how an invented number reaches a store build.
 * - The **http** adapter returns nothing because no emergency-contacts
 *   route exists. Audit BE-11 proposed `GET /public/emergency-contacts`;
 *   DR-09 withdrew every `/public/*` route, and no replacement contract
 *   is defined yet — one that must answer signed out, since Emergency
 *   is reachable signed out. The numbers themselves are owner-blocked.
 *   This adapter is the one service in this tree that does NOT use
 *   `unavailableService`,
 *   because Emergency must never surface an error — an unconfigured
 *   screen is a working screen, a failed screen is not.
 *
 * When such a route lands, the http adapter calls it, validates the response,
 * and falls back to `UNCONFIGURED_EMERGENCY` on any failure. That
 * fallback is not defensive programming; it is the contract.
 */

const unconfigured: EmergencyService = {
  getConfiguration: async () => UNCONFIGURED_EMERGENCY,
};

export const emergencyService: EmergencyService = selectService({
  fixture: unconfigured,
  http: unconfigured,
});
