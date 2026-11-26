import { selectService } from '@/api/seam';
import { env, type ConfiguredEmergencyNumber } from '@/configs/env';

import {
  UNCONFIGURED_EMERGENCY,
  type EmergencyConfiguration,
  type EmergencyService,
} from './model/types';

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

/**
 * The one configuration channel that exists today: the operator's own
 * build-time list, `EXPO_PUBLIC_EMERGENCY_NUMBERS`, validated by the
 * environment schema (`src/configs/env.ts`). Bundled with the app, so it
 * answers signed out and offline — exactly where Emergency must work.
 * Empty → `UNCONFIGURED_EMERGENCY`; the app never supplies a number of
 * its own.
 */
export function configurationFrom(
  numbers: readonly ConfiguredEmergencyNumber[],
): EmergencyConfiguration {
  if (numbers.length === 0) return UNCONFIGURED_EMERGENCY;
  return {
    numbers: numbers.map((n) => ({
      id: n.id,
      label: n.label,
      number: n.number,
      ...(n.whenToUse === undefined ? {} : { whenToUse: n.whenToUse }),
      ...(n.region === undefined ? {} : { region: n.region }),
    })),
    clinic: null,
    source: 'operator',
  };
}

const operatorConfigured: EmergencyService = {
  getConfiguration: async () => configurationFrom(env.emergencyNumbers),
};

export const emergencyService: EmergencyService = selectService({
  fixture: operatorConfigured,
  http: operatorConfigured,
});
