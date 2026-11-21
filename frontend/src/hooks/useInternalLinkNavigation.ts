import { useEffect } from 'react';

import { useNavigate } from 'react-router-dom';

/**
 * Intercepts clicks on same-origin anchors and routes them through React
 * Router. Design-system components are router-agnostic and render plain
 * `<a href>` (FRONTEND_ARCHITECTURE §8.2 — patterns accept links as
 * props); mounting this once in the app shell turns those anchors into
 * SPA navigations without coupling Tier 1–2 components to the router.
 */
export function useInternalLinkNavigation(): void {
  const navigate = useNavigate();

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const anchor = (event.target as Element | null)?.closest('a');
      if (!anchor) return;
      if (anchor.target && anchor.target !== '_self') return;
      if (anchor.hasAttribute('download') || anchor.getAttribute('rel') === 'external') return;

      const href = anchor.getAttribute('href');
      // Same-origin paths only. A bare `startsWith('/')` also admits
      // `//host` and `/\host`, both of which a browser reads as off-site —
      // and React Router 6.30.4 carries an open-redirect advisory for the
      // backslash form (GHSA-wrjc-x8rr-h8h6, open redirect via backslash in
      // `<Link>` and `useNavigate`). Neither is handed to `navigate()`.
      //
      // Such a link is left to the browser rather than cancelled: the anchor
      // already says where it goes, and letting it through keeps the address
      // bar honest instead of laundering an off-site target through the SPA
      // router. Nothing in this tree renders a server-supplied `href`, so
      // this is depth, not a live sink (`resolveDestination` is the one that
      // was).
      if (!href || !href.startsWith('/') || href.startsWith('//') || href.includes('\\')) return;

      event.preventDefault();
      navigate(href);
    };

    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [navigate]);
}
