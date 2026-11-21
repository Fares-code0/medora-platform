import { useEffect, type ReactNode } from 'react';

/**
 * Applies the design-system theme around a story, the way `ThemeProvider`
 * applies it in the app (a `dark` class on the documentElement) rather than
 * through a Storybook-specific mechanism — so what a story shows is what the
 * app renders.
 *
 * It lives in its own file for the reason the lint rule gives: `preview.tsx`
 * exports the Storybook config, and a file that exports both a component and
 * a non-component breaks fast refresh. The decorator there wraps this.
 */
export function ThemedStory({ theme, children }: { theme: string; children: ReactNode }) {
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    return () => {
      document.documentElement.classList.remove('dark');
    };
  }, [theme]);

  return <div className="bg-surface p-6 text-text-primary">{children}</div>;
}
