import { Fragment, useState } from 'react';

import { ChevronRight, Ellipsis } from 'lucide-react';

import { useT } from '@/i18n';
import { cn } from '@/utils/cn';

/**
 * Breadcrumb — DS §8.27.
 * Location trail; current page is text with aria-current="page". Beyond
 * `maxVisible` items the middle collapses behind an expandable ellipsis.
 * Router integration passes generated hrefs; the component stays
 * router-agnostic (FRONTEND_ARCHITECTURE §8.2).
 */
export interface BreadcrumbItem {
  readonly label: string;
  readonly href?: string;
  readonly onClick?: () => void;
}

export interface BreadcrumbProps {
  items: readonly BreadcrumbItem[];
  maxVisible?: number;
  className?: string | undefined;
}

function BreadcrumbLink({ item }: { item: BreadcrumbItem }) {
  /*
   * A crumb is only as tall as its 18px caption, so the target was 52×18
   * (DEBT-1a-02). It plausibly qualified for WCAG 2.5.8's *inline* exception,
   * but a breadcrumb is navigation rather than prose, so the exception is
   * arguable at best — and this is a shared primitive, so it failed on every
   * screen that renders one.
   *
   * Same transparent-overlay technique as the checkbox and sort handles: the
   * hit area grows to 24px, the text does not move, and no row gets taller.
   * `inset-x-0` because crumbs are already wider than 24px; only height is
   * short.
   */
  const classes =
    "touch-target relative rounded-control text-body-sm text-text-secondary transition-colors duration-fast [--touch-y:13px] before:absolute before:inset-x-0 before:top-1/2 before:h-6 before:-translate-y-1/2 before:content-[''] hover:text-text-primary hover:underline";
  if (item.href !== undefined) {
    return (
      <a href={item.href} onClick={item.onClick} className={classes}>
        {item.label}
      </a>
    );
  }
  return (
    <button type="button" onClick={item.onClick} className={classes}>
      {item.label}
    </button>
  );
}

export function Breadcrumb({ items, maxVisible = 4, className }: BreadcrumbProps) {
  const [expanded, setExpanded] = useState(false);
  const t = useT();
  const collapse = !expanded && items.length > maxVisible;
  const visibleItems: ReadonlyArray<BreadcrumbItem | 'ellipsis'> = collapse
    ? [items[0] as BreadcrumbItem, 'ellipsis', ...items.slice(items.length - 2)]
    : items;

  return (
    <nav aria-label={t('shell.breadcrumb')} className={className}>
      <ol className="flex flex-wrap items-center gap-2">
        {visibleItems.map((item, index) => {
          const isLast = index === visibleItems.length - 1;
          return (
            <Fragment key={item === 'ellipsis' ? 'ellipsis' : `${item.label}-${String(index)}`}>
              <li className="inline-flex items-center">
                {item === 'ellipsis' ? (
                  <button
                    type="button"
                    aria-label={t('shell.breadcrumbExpand')}
                    onClick={() => setExpanded(true)}
                    // 16px glyph + 4px padding = a 20px target; the overlay
                    // lifts it to 24px without widening the crumb trail.
                    className="touch-target relative rounded-control p-0.5 text-text-tertiary transition-colors duration-fast [--touch-x:12px] [--touch-y:12px] before:absolute before:start-1/2 before:top-1/2 before:h-6 before:w-6 before:-translate-x-1/2 before:-translate-y-1/2 before:rtl:translate-x-1/2 before:content-[''] hover:text-text-primary"
                  >
                    <Ellipsis aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
                  </button>
                ) : isLast ? (
                  <span aria-current="page" className="text-body-sm font-medium text-text-primary">
                    {item.label}
                  </span>
                ) : (
                  <BreadcrumbLink item={item} />
                )}
              </li>
              {!isLast ? (
                <li
                  aria-hidden="true"
                  className={cn('inline-flex items-center text-text-disabled')}
                >
                  <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
                </li>
              ) : null}
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
