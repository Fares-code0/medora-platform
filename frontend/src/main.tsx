import { StrictMode } from 'react';

import { createRoot } from 'react-dom/client';

import '@fontsource-variable/open-sans';
import '@fontsource/jetbrains-mono/400.css';
import '@/styles/globals.css';

import { App } from '@/app/App';
import { loadCatalogue, storedLocale } from '@/i18n';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found');
}
const root = createRoot(rootElement);

/*
 * The stored language's catalogue first, then the app (NEW-21). Only the
 * English catalogue is in the entry chunk; rendering before a returning
 * Arabic user's catalogue arrives would paint English, left-to-right, and
 * then flip. English resolves at once. A failed load renders in English
 * rather than not at all.
 */
void loadCatalogue(storedLocale())
  .catch(() => undefined)
  .then(() => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
