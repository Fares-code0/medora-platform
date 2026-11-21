import { notConnected } from '@/api/http';
import { ErrorState } from '@/components/feedback';

import { SECTION_META } from '../administration.meta';
import type { AdminSectionSlug } from '../administration.types';

import { SectionShell } from './SectionShell';

/**
 * An administration section with no backend behind it, in a live build
 * (FE-10.10 — the FE-10 §18 posture).
 *
 * These screens are built over seeded demo stores: clinic operations, the
 * patient roster, communications, logs, reports. Rendering them next to a
 * real administrator's session would put fictional patients and fictional
 * staff in front of someone who has every reason to believe they are real.
 * So the live route renders the section's own header and says it is not
 * connected — the same wording every other unconnected surface uses — and
 * the demo build keeps the full screen.
 */
export function NotConnectedSection({ slug }: { slug: AdminSectionSlug }) {
  return (
    <SectionShell slug={slug}>
      <ErrorState error={notConnected(SECTION_META[slug].label)} headingLevel="h2" />
    </SectionShell>
  );
}
