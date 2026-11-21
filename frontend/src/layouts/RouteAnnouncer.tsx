import { useEffect, useRef, useState } from 'react';

/**
 * Announces the page a client-side navigation landed on — F-15/F-16/F-17's
 * missing fourth.
 *
 * ## Why the document title is not enough
 *
 * `useDocumentTitle` already names every route (WCAG 2.4.2), and in a
 * multi-page site that is the whole job: the browser loads a document and the
 * screen reader announces its title. In a single-page app the document never
 * reloads — React swaps the outlet and writes `document.title` — and screen
 * readers do **not** reliably announce a title that changed without a
 * navigation event. The result is the defect this component exists for: a
 * screen-reader user follows a sidebar link, focus stays on the link they
 * activated (which is correct — moving it on every navigation is its own
 * hazard), the page under them silently becomes a different page, and nothing
 * says so.
 *
 * A polite live region is the standard answer. It reads the new page's name
 * once, after the swap, without stealing focus.
 *
 * ## Three details that decide whether it works
 *
 * **It reads the same source as the title.** `AppShell` passes what
 * `useRouteTitle()` returned, so the announcement and the tab label cannot
 * disagree — a second derivation is a second thing to keep in sync.
 *
 * **It stays silent on first render.** On a fresh load the browser has already
 * announced the document, and a live region populated during that same render
 * would either be missed (the region did not exist when the content appeared)
 * or double up. It announces only on a *change* of title, which is exactly the
 * event that has no other signal.
 *
 * **The region exists before the text does.** A live region added to the DOM
 * with its content already in place is not reliably announced — the
 * announcement is triggered by a mutation *inside* an existing region. The
 * element is therefore always rendered and only its text changes, which is
 * also why this is a component rather than a hook writing into some other
 * node.
 */
export function RouteAnnouncer({ title }: { title: string | null }) {
  const [announcement, setAnnouncement] = useState('');
  const previous = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    // `undefined` is the first render; `null` is a route with no crumb, which
    // is a page worth announcing nothing about rather than one to skip.
    if (previous.current === undefined) {
      previous.current = title;
      return;
    }
    if (previous.current === title) return;
    previous.current = title;
    setAnnouncement(title ?? '');
  }, [title]);

  return (
    <div aria-live="polite" aria-atomic="true" className="sr-only" data-testid="route-announcer">
      {announcement}
    </div>
  );
}
