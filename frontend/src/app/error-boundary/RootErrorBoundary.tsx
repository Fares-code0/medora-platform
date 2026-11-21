import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

import { Logo } from '@/shared/components/branding';

/**
 * Root error boundary — FRONTEND_ARCHITECTURE.md §2 (app/error-boundary).
 * Last line of defense; route-level boundaries (react-router errorElement)
 * catch feature errors first. Renders the DS full-page error pattern.
 * No PHI ever appears in error output (§12.2).
 */

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class RootErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Telemetry hook (Phase 9): report without PHI.
    console.error('Uncaught application error', error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background p-6 text-center">
          <Logo size="md" label="Medora" className="mb-6" />
          <h1 className="text-h2 font-semibold text-text-primary">Something went wrong</h1>
          <p className="max-w-prose text-body text-text-secondary">
            An unexpected error occurred. Your data is safe. Reload the page to continue.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 rounded-surface bg-primary-fill px-5 py-3 text-body-sm font-semibold text-primary-fill-text transition-colors duration-fast hover:bg-primary-fill-hover"
          >
            Reload Medora
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
