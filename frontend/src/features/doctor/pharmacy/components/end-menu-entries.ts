import { Trash2, type LucideIcon } from 'lucide-react';

import type { MenuEntry } from '@/components/ui';

import {
  DISCARD_DRAFT_LABEL,
  END_ACT_LABEL,
  endActFor,
  isDiscardableDraft,
} from '../model/selectors';
import type { PrescriptionSummary } from '../model/types';

/**
 * The end-of-life entry for a prescription's menus (DEC-002) — the same in
 * the row menu and on the detail page:
 *
 * - pending approval → "Cancel prescription"; active or dispensed →
 *   "Discontinue" (`endActFor`);
 * - an unsigned draft → "Discard draft" (BR-DEC-002) — the server refuses
 *   to cancel or discontinue one, and discarding is its own route;
 * - already ended → nothing.
 *
 * `onSelect` is the one entry point for all three: the lifecycle hook opens
 * the end dialog or the discard confirmation as the status requires.
 */
export function endMenuEntries(
  prescription: PrescriptionSummary,
  onSelect: () => void,
  icon: LucideIcon,
): MenuEntry[] {
  const act = endActFor(prescription);
  if (act !== null) {
    return [{ id: `end-${act}`, label: END_ACT_LABEL[act], icon, destructive: true, onSelect }];
  }
  if (isDiscardableDraft(prescription)) {
    return [
      {
        id: 'discard-draft',
        label: DISCARD_DRAFT_LABEL,
        icon: Trash2,
        destructive: true,
        onSelect,
      },
    ];
  }
  return [];
}
