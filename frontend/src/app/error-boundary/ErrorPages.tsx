import { Link, useRouteError } from 'react-router-dom';

import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { routes } from '@/routes';
import { Logo } from '@/shared/components/branding';

/**
 * Full-page error patterns — DS §8.33 (404 / 403 / route error).
 * Plain-language copy: what happened, what to do next. Support reference
 * codes appear as secondary captions only.
 *
 * The shell names the browser tab from the same `title` it renders as the
 * `h1`, so a 404 in history is distinguishable from a 403 (WCAG 2.4.2). These
 * three strings are English literals, unlike the auth branch's: they belong to
 * the ~2,045 untranslated feature-interior strings `docs/handoff/i18n.md` §6
 * tracks, and inventing translations for them here would put four unverified
 * clinical-adjacent renderings in the catalogue for no gain.
 */

function ErrorPageShell({
  code,
  title,
  description,
}: {
  code: string;
  title: string;
  description: string;
}) {
  useDocumentTitle(title);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background p-6 text-center">
      <Logo size="md" label="Medora" className="mb-6" />
      <p className="font-mono text-caption text-text-tertiary">{code}</p>
      <h1 className="text-h2 font-semibold text-text-primary">{title}</h1>
      <p className="max-w-prose text-body text-text-secondary">{description}</p>
      <Link
        to={routes.root}
        className="mt-4 rounded-surface bg-primary-fill px-5 py-3 text-body-sm font-semibold text-primary-fill-text transition-colors duration-fast hover:bg-primary-fill-hover"
      >
        Go to dashboard
      </Link>
    </div>
  );
}

export function NotFoundPage() {
  return (
    <ErrorPageShell
      code="404"
      title="Page not found"
      description="The page you're looking for doesn't exist or may have been moved."
    />
  );
}

export function ForbiddenPage() {
  return (
    <ErrorPageShell
      code="403"
      title="You don't have access to this page"
      description="Your account doesn't include permission to view this area. If you believe this is a mistake, contact your administrator."
    />
  );
}

export function RouteErrorPage() {
  const error = useRouteError();
  console.error('Route error', error);
  return (
    <ErrorPageShell
      code="Error"
      title="This page couldn't be loaded"
      description="Something went wrong while loading this page. Going back to the dashboard usually resolves it."
    />
  );
}
