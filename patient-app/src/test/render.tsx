import type { ReactElement, ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ToastProvider } from '@/components';
import { LocaleProvider, type Locale } from '@/i18n';
import { ThemeProvider, type ThemeMode } from '@/theme';

/**
 * The test renderer.
 *
 * Wraps a component in the same providers `App.tsx` does, minus the
 * session and the navigator, so a component test exercises real theming
 * and real query behaviour rather than a stripped-down substitute.
 *
 * `mode` is a first-class option because "does this render correctly in
 * dark mode?" is a test this app has to be able to write cheaply — the
 * dark-mode failures §8 of the brief lists are all invisible to a
 * light-only test suite.
 *
 * `LocaleProvider` is here for the same reason it is in `App.tsx` and in
 * the same position — above the theme, because direction is a layout
 * property. Since the state components read their copy from the
 * catalogue (C-09), a test that rendered without it would throw rather
 * than fall back, which is the correct behaviour and a poor test failure
 * message. It defaults to English, so an assertion on English copy means
 * what it did before, and `locale` is the option that makes "does this
 * screen read in Arabic?" as cheap to ask as the dark-mode question.
 */
const SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

export function renderWithProviders(
  ui: ReactElement,
  options: { mode?: ThemeMode; locale?: Locale } & Omit<RenderOptions, 'wrapper'> = {},
) {
  const { mode = 'light', locale = 'en', ...rest } = options;

  // Retries off: a test asserting an error state should not wait for
  // three attempts and a backoff to see it.
  //
  // `mutations.gcTime: Infinity` is not about the cache — it is about the
  // worker exiting. A settled mutation is garbage-collected on a timer,
  // and the default is five minutes, so a single `useMutation` in a test
  // leaves a five-minute `setTimeout` behind and Jest waits for it
  // ("a worker process has failed to exit gracefully"). `Infinity` is
  // never a valid timeout, so no timer is scheduled at all, and the
  // client is discarded with the test.
  // `networkMode` mirrors `createQueryClient()` rather than taking the
  // library default, because the app pins it: `'online'` PAUSES a query
  // while `onlineManager` says the device is offline, so a test that
  // drives NetInfo offline would see a screen that never asks — which
  // is not what the app does, and is a failure about the test harness
  // wearing the shape of a failure about the screen.
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { networkMode: 'always', retry: false, gcTime: 0 },
      mutations: { networkMode: 'always', retry: false, gcTime: Infinity },
    },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>
        <LocaleProvider initialLocale={locale}>
          <ThemeProvider initialMode={mode}>
            <QueryClientProvider client={queryClient}>
              <ToastProvider>{children}</ToastProvider>
            </QueryClientProvider>
          </ThemeProvider>
        </LocaleProvider>
      </SafeAreaProvider>
    );
  }

  return { ...render(ui, { wrapper: Wrapper, ...rest }), queryClient };
}
