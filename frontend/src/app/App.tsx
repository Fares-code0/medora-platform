import { useState } from 'react';

import { MedoraIntro, shouldPlayMedoraIntro } from '@/shared/components/branding';

import { RootErrorBoundary } from './error-boundary/RootErrorBoundary';
import { LocaleRemount } from './LocaleRemount';
import { AppProviders } from './providers';
import { AppRouter } from './router';

/**
 * Application composition root — FRONTEND_ARCHITECTURE.md §2.
 * Boundary → providers → router.
 *
 * The brand entrance is the one thing that sits beside that chain rather than
 * inside it: it has to cover the app while the app is still mounting, so it is
 * a sibling of the provider tree. The app renders at full opacity beneath it
 * and the overlay's own fade is the reveal (DEC-012). Starting the app at
 * opacity 0 instead hid every first-visit paint from Largest Contentful Paint
 * — Chrome does not count a paint at opacity 0 as contentful. It plays once
 * per browsing session (`shouldPlayMedoraIntro`, seeded into state so a
 * re-render never restarts it), and any tap or key press skips it.
 */
export function App() {
  const [playIntro] = useState(shouldPlayMedoraIntro);

  return (
    <RootErrorBoundary>
      {playIntro ? <MedoraIntro /> : null}
      <AppProviders>
        <LocaleRemount>
          <AppRouter />
        </LocaleRemount>
      </AppProviders>
    </RootErrorBoundary>
  );
}
