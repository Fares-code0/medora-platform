import { describe, expect, it } from 'vitest';

import { translate } from '@/i18n';
import { ar } from '@/i18n/messages/ar';

import { SAFETY_EVIDENCE_META } from './safety-check';

/*
 * The safety-screen evidence carries the demo-formulary disclosure ("…must
 * not be relied on for care"). Like the shared-domain maps, it holds an
 * English label/detail for model code beside the keys components render, so
 * both are held in step here — and the Arabic must be a real translation,
 * never the English, because this is the line that says the check is not a
 * clinical interaction service.
 */
describe('SAFETY_EVIDENCE_META', () => {
  it.each(Object.entries(SAFETY_EVIDENCE_META))(
    '%s: label and detail keys render their English text, and are translated in Arabic',
    (_, meta) => {
      expect(translate('en', meta.labelKey)).toBe(meta.label);
      expect(translate('en', meta.detailKey)).toBe(meta.detail);
      expect(ar[meta.labelKey]).not.toBe(meta.label);
      expect(ar[meta.detailKey]).not.toBe(meta.detail);
      expect(ar[meta.detailKey]).toMatch(/[؀-ۿ]/);
    },
  );
});
