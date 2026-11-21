import { useEffect, useState } from 'react';

import { logger } from '@/utils/logger';

import { UNCONFIGURED_EMERGENCY, type EmergencyConfiguration } from '../model/types';
import { emergencyService } from '../service';

/**
 * The Emergency screen's only data hook.
 *
 * ── Why this is not a TanStack Query hook ────────────────────────────
 * Every other data hook in this app is one. This one is not, and the
 * difference is the point: `useQuery` has a loading state, an error state
 * and a retry policy, and the Emergency screen must have **none of
 * them**. It renders immediately, with whatever it has, and it never
 * shows a spinner or an error — the bundled guidance is the screen, and
 * operator-supplied numbers are an addition to it.
 *
 * So: start from `UNCONFIGURED_EMERGENCY` synchronously, replace it if
 * the service resolves, and swallow any failure. There is no state in
 * which this hook makes the screen worse than not calling it.
 */
export function useEmergencyConfiguration(): EmergencyConfiguration {
  const [configuration, setConfiguration] =
    useState<EmergencyConfiguration>(UNCONFIGURED_EMERGENCY);

  useEffect(() => {
    let active = true;
    emergencyService
      .getConfiguration()
      .then((next) => {
        if (active) setConfiguration(next);
      })
      .catch(() => {
        // Deliberately silent to the patient. The screen already renders
        // everything it must; a failure here only means no operator
        // numbers, which is the documented default state.
        logger.warn('Emergency configuration unavailable; showing bundled guidance only');
      });
    return () => {
      active = false;
    };
  }, []);

  return configuration;
}
