import { describe, expect, it } from 'vitest';

import { translate } from '@/i18n';

import {
  LAB_ATTACHMENT_KIND_META,
  LAB_PRIORITY_META,
  LAB_RESULT_FLAG_META,
  LAB_STATUS_META,
} from './lab-studies/types';
import { PATIENT_STATUS_META, RISK_LEVEL_META } from './patient-identity/types';
import {
  PRESCRIPTION_STATUS_META,
  PRESCRIPTION_TIMELINE_META,
  REFILL_STATUS_META,
  SAFETY_WARNING_KIND_META,
  SAFETY_WARNING_SEVERITY_META,
} from './prescriptions/types';

/**
 * The shared clinical vocabularies carry each label twice during the Arabic
 * rollout: `labelKey`, which components render through `useT()`, and the
 * English `label`, which model code not yet localized (filter chips, exports,
 * trend tooltips) still reads. This holds the two in step, so an English
 * user sees the same word whichever path drew it.
 */
const MAPS = {
  LAB_STATUS_META,
  LAB_PRIORITY_META,
  LAB_RESULT_FLAG_META,
  LAB_ATTACHMENT_KIND_META,
  PATIENT_STATUS_META,
  RISK_LEVEL_META,
  PRESCRIPTION_STATUS_META,
  REFILL_STATUS_META,
  SAFETY_WARNING_KIND_META,
  SAFETY_WARNING_SEVERITY_META,
  PRESCRIPTION_TIMELINE_META,
};

describe('shared-domain label maps', () => {
  it.each(Object.entries(MAPS))('%s: every labelKey renders its English label', (_, map) => {
    for (const [value, meta] of Object.entries(map)) {
      expect(translate('en', meta.labelKey), value).toBe(meta.label);
    }
  });
});
