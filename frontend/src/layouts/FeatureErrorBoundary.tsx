import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

import { FeatureErrorFallback } from './FeatureErrorFallback';

/**
 * Catches a crash in the routed feature **without taking the shell with it**
 * — FRONTEND_ARCHITECTURE.md §2's "route-level boundaries catch feature errors
 * first", which until now was a description of an intention rather than of the
 * code.
 *
 * ## What it changes
 *
 * The router declares one `errorElement`, on its outermost route. That works —
 * a component throwing renders the full-page error pattern rather than a white
 * screen, verified by injecting a render crash into `/doctor/reports`. But
 * because the boundary sits above everything, the recovery it offers is *the
 * whole app*: the sidebar, the navbar, the breadcrumb and the notification bell
 * all disappear along with the page that failed, and the only way onward is a
 * link back to the dashboard.
 *
 * A crash in one feature is not a reason to remove the navigation from the
 * other twelve. This boundary sits inside `AppShell`, around the `<Outlet />`,
 * so it is deeper in the tree than the router's and therefore catches first.
 * The chrome stays; the failed page becomes an error state in the content area
 * with a Retry; and the user can simply click something else.
 *
 * ## Why it resets on navigation
 *
 * A React error boundary latches. Without a reset a user who crashed one page
 * and then navigated away would keep seeing the error under working chrome,
 * which is worse than the full-page version — it would look like every page
 * was broken. `resetKey` is the pathname: changing it clears the error, so
 * moving to another page renders that page.
 *
 * The router's own `errorElement` stays exactly where it is. This does not
 * replace it — it is the layer beneath, and anything that escapes the shell
 * (a crash in the shell itself, a loader error) still lands there.
 */
interface Props {
  /** Changing this clears a latched error — pass the current pathname. */
  readonly resetKey: string;
  readonly children: ReactNode;
}

interface State {
  readonly hasError: boolean;
  readonly resetKey: string;
}

export class FeatureErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false, resetKey: this.props.resetKey };

  static getDerivedStateFromError(): Partial<State> {
    return { hasError: true };
  }

  /**
   * The reset, done in `getDerivedStateFromProps` rather than in an effect:
   * a class boundary has no effects, and clearing on the render that already
   * has the new route avoids painting the stale error for one frame.
   */
  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey === state.resetKey) return null;
    return { hasError: false, resetKey: props.resetKey };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Same contract as the root boundary: report without PHI (§12.2).
    console.error('Feature error', error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="mx-auto max-w-container-md px-4 py-10">
          <FeatureErrorFallback onRetry={() => this.setState({ hasError: false })} />
        </div>
      );
    }
    return this.props.children;
  }
}
