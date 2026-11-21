import { useMatches } from 'react-router-dom';

import { Breadcrumb, type BreadcrumbItem } from '@/components/ui';

import type { RouteHandle } from '../navigation';

/**
 * Breadcrumbs from route handles — FRONTEND_ARCHITECTURE.md §4.
 * Walks useMatches(); any route carrying `handle.crumb` contributes a
 * level, so no page writes its own breadcrumb code. Static labels now;
 * data-driven resolvers (e.g. patient name) arrive with their features.
 */
export function AppBreadcrumb({ className }: { className?: string | undefined }) {
  const matches = useMatches();

  const items: BreadcrumbItem[] = matches
    .filter(
      (match): match is typeof match & { handle: Required<RouteHandle> } =>
        typeof (match.handle as RouteHandle | undefined)?.crumb === 'string',
    )
    .map((match) => ({ label: match.handle.crumb, href: match.pathname }));

  if (items.length === 0) return null;

  // The current page renders as text, not a link (Breadcrumb handles
  // aria-current); strip the href from the last item.
  const trail: BreadcrumbItem[] = items.map((item, index) =>
    index === items.length - 1 ? { label: item.label } : item,
  );

  return <Breadcrumb items={trail} className={className} />;
}
