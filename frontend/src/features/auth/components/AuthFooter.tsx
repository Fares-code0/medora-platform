/**
 * Auth footer — version + copyright line shown beneath the auth card.
 * The language and theme controls live in the layout header (shared across
 * all auth pages), so the footer stays to product metadata only.
 */

// Wire to package.json / a Vite `define` at build time later; static for now.
const APP_VERSION = '0.1.0';

export function AuthFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="mt-8 text-center text-caption text-text-tertiary">
      {/*
        `dir="ltr"` because the content is Latin-only and the document may
        not be (F-19). Inside an RTL paragraph the Unicode bidi algorithm
        moves the trailing run to the front — "© 2026 Medora · v0.1.0"
        renders as "Medora · v0.1.0 2026 ©" in Arabic. The fix is to isolate
        the run, not to reword it: this is the rule for any string that is
        an identifier, a version, an address or a code rather than prose.
      */}
      <p dir="ltr">
        © {year} Medora · v{APP_VERSION}
      </p>
    </footer>
  );
}
