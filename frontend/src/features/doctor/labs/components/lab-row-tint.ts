import { isCriticalUnreviewed } from '../model/review';
import type { LabTest } from '../model/types';

/**
 * UX §2.6: "Critical rows tint error-subtle". Returned as a class rather than
 * applied by a component, because the row is the DataTable's element and the
 * mobile card's, and both need the same answer.
 *
 * In its own module rather than beside the cells it belongs with: a `.tsx`
 * that exports a non-component breaks Fast Refresh for the whole file, and
 * `LabCells.tsx` is edited often enough for that to matter.
 * Tint follows *unreviewed* critical, not critical: once a doctor has
 * acknowledged the value the row is no longer a call to action, and leaving
 * every historic critical result painted red is how a red row stops meaning
 * anything.
 */
export function labRowClassName(test: LabTest): string | undefined {
  // Released criticals only (`isCriticalUnreviewed` reads the release rule):
  // a provisional value on a processing order is not yet anyone's to review.
  const unreviewedCritical = isCriticalUnreviewed(test);
  // `--row-bg` too, so a pinned first cell (DataTable, DEC-015) shows the same tint.
  return unreviewedCritical ? 'bg-error-subtle [--row-bg:var(--color-error-subtle)]' : undefined;
}
