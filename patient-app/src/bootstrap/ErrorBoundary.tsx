import { Component, type ErrorInfo, type ReactNode } from 'react';

import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Text } from '@/components/Text';
import { logger } from '@/utils/logger';
import { reportCrash } from '@/utils/monitoring';

/**
 * The global render-crash boundary.
 *
 * A React render error unmounts the whole tree and leaves a white screen
 * (checklist R-05). On the web that is a refresh away from recovered; on
 * a phone the patient force-quits and, often, uninstalls.
 *
 * **What is logged, and what is not.** The message and the component
 * stack, and nothing else. Not the props, not the state, not the error's
 * own `cause` — a crash inside a records screen has PHI in all three,
 * and a crash report containing a diagnosis is a disclosure to whoever
 * operates the crash service (checklist T-04, W-04). The component stack
 * is developer-authored file and component names, which is safe.
 */
interface Props {
  readonly children: ReactNode;
  /** Test seam: lets a test assert the fallback without a real crash. */
  readonly onReset?: () => void;
}

interface State {
  readonly hasError: boolean;
}

/**
 * Fixed copy. Held here rather than inline because the screen-reader
 * label is the same two sentences and a drifted copy is a screen reader
 * announcing something the screen does not say.
 */
const TITLE = 'Medora ran into a problem';
const BODY =
  'This screen stopped working. Nothing you entered was sent. If you need urgent help, call your local emergency number.';

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    logger.error('Render crash', {
      // Passed under a key the redaction deny-list covers, and that is
      // the intent rather than an accident: `errorMessage` normalises to
      // `errormessage`, `redact()` sees `message`, and the value is
      // replaced before the line reaches a sink. A render crash message
      // is not reliably developer-authored — `Unknown severity for
      // allergen Penicillin` is the shape these take inside a records
      // screen — so the safe reading is the redacted one. The key is
      // kept so the field's absence is visible in the report rather
      // than silent.
      //
      // What makes the report actionable is the line below: the
      // component stack is developer-authored file and component names,
      // which is safe and is enough to find the render that threw.
      errorMessage: error.message,
      componentStack: info.componentStack ?? '(unavailable)',
    });

    // And to the crash reporter (W-04). The log line above is what a
    // developer reads on a connected device; this is what leaves it.
    // They are separate calls rather than one because `monitoring.ts`
    // drops the message entirely rather than redacting it by key — a
    // report is read by whoever operates the crash service, and the
    // stack frames plus this component stack locate the render without
    // it. The `logger.error` above lands in the report's own breadcrumb
    // trail, so the sequence that led here travels with it.
    reportCrash(error, {
      kind: 'render',
      fatal: false,
      componentStack: info.componentStack ?? null,
    });
  }

  private readonly reset = (): void => {
    this.setState({ hasError: false });
    this.props.onReset?.();
  };

  override render(): ReactNode {
    if (!this.state.hasError) return this.props.children;

    return (
      <View style={styles.container} testID="error-boundary-fallback">
        {/*
          The message is one grouped live region so a screen reader
          announces it whole, the way `ErrorState` does — a patient who
          cannot see the crash screen otherwise hears three fragments in
          whatever order focus lands.

          The Button is deliberately OUTSIDE the group. `accessible` on
          a View collapses its subtree into a single element on iOS, so
          a Try again inside it stops being focusable — the one control
          on the one screen that has no other way out.
        */}
        <View
          testID="error-boundary-message"
          accessible
          accessibilityLiveRegion="polite"
          accessibilityLabel={`${TITLE}. ${BODY}`}
          style={styles.message}
        >
          <Icon name="alert" size={40} color="error" />
          <Text variant="h2" align="center">
            {TITLE}
          </Text>
          <Text variant="bodySm" color="textTertiary" align="center">
            {BODY}
          </Text>
        </View>
        <Button label="Try again" onPress={this.reset} testID="error-boundary-retry" />
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    rowGap: 16,
  },
  message: {
    alignItems: 'center',
    rowGap: 16,
  },
});
