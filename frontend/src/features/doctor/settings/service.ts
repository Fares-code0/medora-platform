import { selectService } from '@/api/seam';

import { httpSettingsService } from './http/http-settings-service';
import { mockSettingsService } from './mock/mock-settings-service';
import type { SettingsService } from './model/settings-service';

/**
 * The settings seam's selection point (FE-10.9) — the only module the feature
 * imports for its data (`docs/handoff/auth-seam.md` §1, rule 3), and the only
 * one that reads the mock flag for it, through `selectService`.
 */
export const settingsService: SettingsService = selectService({
  mock: mockSettingsService,
  http: httpSettingsService,
});
