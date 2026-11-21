import type { ReactNode } from 'react';

import { Section } from '@/components/layout';
import { Card } from '@/components/ui';

/**
 * One lab-detail section: a Card wrapping a titled Section (h2 — the page
 * h1 is the lab id in the ContentHeader). Every detail section renders
 * through this so heading levels and spacing stay uniform.
 */
export function LabSectionCard({
  title,
  caption,
  actions,
  children,
}: {
  title: string;
  caption?: string | undefined;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <Section title={title} caption={caption} actions={actions} headingAs="h2">
        {children}
      </Section>
    </Card>
  );
}

/** Muted placeholder line for sections with nothing recorded yet. */
export function EmptySectionNote({ children }: { children: ReactNode }) {
  return <p className="text-body-sm text-text-tertiary">{children}</p>;
}
