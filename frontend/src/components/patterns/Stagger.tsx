import type { ReactNode } from 'react';

import { Reveal } from './Reveal';

/**
 * Stagger — sequences a band of widgets into one entrance.
 *
 * It owns the index arithmetic, which is the point: callers never write an
 * index, so two siblings cannot share one. The previous hand-indexed API
 * let OverviewPage pass index={8} to two widgets, which animated in
 * together. The `items` shape mirrors the Tabs primitive.
 */
export interface StaggerItem {
  readonly key: string;
  /** Layout classes for this item's wrapper (e.g. a grid-column span). */
  readonly className?: string;
  readonly content: ReactNode;
}

export interface StaggerProps {
  items: readonly StaggerItem[];
  /** Index the first item starts at, continuing an earlier band's sequence. */
  startIndex?: number;
  className?: string;
}

export function Stagger({ items, startIndex = 0, className }: StaggerProps) {
  return (
    <div className={className}>
      {items.map((item, offset) => (
        <Reveal key={item.key} index={startIndex + offset} className={item.className}>
          {item.content}
        </Reveal>
      ))}
    </div>
  );
}
