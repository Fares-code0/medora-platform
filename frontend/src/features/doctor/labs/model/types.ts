import {
  Ban,
  CheckCircle2,
  FlaskConical,
  Microscope,
  Stethoscope,
  TestTube,
  Truck,
  type LucideIcon,
} from 'lucide-react';

import type { LabTimelineKind } from '@/features/shared-domain/lab-studies';

/**
 * Laboratory presentation model.
 *
 * **The model itself moved to `shared-domain/lab-studies` in D-05**, together
 * with the StatusBadge meta maps, because the patient profile's "Lab results"
 * tab lists the same orders and §3.4 forbids it importing this feature. Two
 * copies of the status mapping is how that tab ends up calling an order
 * "Processing" that this screen calls "Collected".
 *
 * What remains here is the one map that is genuinely this feature's own: the
 * timeline icons, which bind the model to `lucide-react` and which only the
 * labs detail page draws.
 *
 * Everything from the shared model is re-exported below, so the 36 modules
 * that import `model/types` did not change, and a reader following an import
 * still lands somewhere that names the whole model.
 */

export * from '@/features/shared-domain/lab-studies';

export const LAB_TIMELINE_META: Record<
  LabTimelineKind,
  { readonly label: string; readonly icon: LucideIcon }
> = {
  ordered: { label: 'Order placed', icon: Stethoscope },
  collected: { label: 'Specimen collected', icon: TestTube },
  received: { label: 'Received in lab', icon: Truck },
  processing: { label: 'Processing started', icon: FlaskConical },
  resulted: { label: 'Results entered', icon: Microscope },
  verified: { label: 'Verified & released', icon: CheckCircle2 },
  cancelled: { label: 'Order cancelled', icon: Ban },
};
