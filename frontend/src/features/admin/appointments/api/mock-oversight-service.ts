import { summarize } from '../oversight';

import type { OversightService } from './oversight-service';
import { oversightApi } from './oversight.api';

/** The demo adapter: the seeded oversight store, histories and all. */
export const mockOversightService: OversightService = {
  capabilities: { history: true },
  list: () => oversightApi.list(),
  summary: async () => summarize((await oversightApi.list()).appointments, Date.now()),
  nudge: (input) => oversightApi.nudge(input),
  reassign: (input) => oversightApi.reassign(input),
  cancelAdministratively: (input) => oversightApi.cancelAdministratively(input),
};
