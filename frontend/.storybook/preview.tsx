import type { Decorator, Preview } from '@storybook/react-vite';

import '@/styles/globals.css';

import { ThemedStory } from './ThemedStory';

/**
 * Every story renders under the app's real tokens, and can be seen in both
 * themes without leaving the story — §8.2's "light + dark" acceptance
 * criterion. The wrapper that applies the theme lives in `ThemedStory.tsx`;
 * a file exporting both a component and this config breaks fast refresh.
 */

const withTheme: Decorator = (Story, context) => (
  <ThemedStory theme={String(context.globals.theme)}>
    <Story />
  </ThemedStory>
);

const preview: Preview = {
  decorators: [withTheme],
  globalTypes: {
    theme: {
      description: 'Design-system theme',
      toolbar: {
        title: 'Theme',
        icon: 'circlehollow',
        items: [
          { value: 'light', title: 'Light' },
          { value: 'dark', title: 'Dark' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: 'light' },
  parameters: {
    controls: { expanded: true },
    // §8.2 names axe checks as part of the acceptance artifact, so the addon
    // runs on every story rather than being opt-in per component.
    a11y: { test: 'error' },
  },
};

export default preview;
