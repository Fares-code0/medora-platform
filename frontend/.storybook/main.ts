import type { StorybookConfig } from '@storybook/react-vite';

/**
 * The component workbench (F-09).
 *
 * `FRONTEND_ARCHITECTURE.md` §8.2.4 makes workbench stories the acceptance
 * artifact for Tier 1–2 components — every DS state, both themes, axe checks
 * — and `src/components/__stories__/README.md` recorded that no framework had
 * been chosen, so no story could be committed without failing `tsc -b`.
 * ADR-0004 records the measured choice.
 *
 * It reuses the app's own Vite config rather than declaring a second one, so
 * a story renders a component through the same alias resolution, PostCSS and
 * Tailwind pipeline the app uses. A workbench that builds its subject
 * differently from production is a workbench that can lie.
 */
const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-a11y'],
  framework: { name: '@storybook/react-vite', options: {} },
  core: { disableTelemetry: true },
  typescript: {
    // The project's own tsc is the gate; duplicating it here only slows the
    // workbench down and can disagree with it.
    check: false,
  },
  /*
   * The demo-access boundary check proves the app's production bundle had the
   * development sign-in stubbed out — and fails when the stub replaced
   * nothing. A workbench build never imports `features/auth/dev/`, so the
   * check failed every `build-storybook` once it learned to demand proof
   * (50d9807). The stub plugin stays, so a story that did reach those modules
   * would still get the stubs; only the app-graph assertion is dropped here.
   * `npm run build` is untouched.
   */
  viteFinal: (viteConfig) => ({
    ...viteConfig,
    plugins: (viteConfig.plugins ?? []).filter(
      (plugin) =>
        !(
          plugin !== null &&
          typeof plugin === 'object' &&
          'name' in plugin &&
          plugin.name === 'medora:demo-access-boundary'
        ),
    ),
  }),
};

export default config;
