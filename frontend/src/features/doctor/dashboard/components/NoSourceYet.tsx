import { DatabaseZap } from 'lucide-react';

import { EmptyState } from '@/components/feedback';

/**
 * What a widget shows when the server has no source for it yet (FE-10.4).
 *
 * The honest alternative to the mock's figures in a live build: the widget
 * keeps its place and its title, and says plainly that there is nothing
 * real to show — rather than disappearing (which reads as a bug) or
 * showing a seeded number (which reads as a measurement).
 */
export function NoSourceYet({ what }: { what: string }) {
  return (
    <EmptyState
      icon={DatabaseZap}
      title="Not available yet"
      description={`The Medora server does not provide ${what} yet.`}
    />
  );
}
