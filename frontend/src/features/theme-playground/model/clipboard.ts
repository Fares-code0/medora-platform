/**
 * Copy text, and say honestly what happened.
 *
 * `navigator.clipboard` is absent outside a secure context (plain-http LAN
 * addresses, some embedded browsers) and its `writeText` rejects when the
 * browser withholds permission. The previous version chained straight off
 * `navigator.clipboard?.writeText(…)`: with no clipboard the optional chain
 * short-circuited the whole promise, so the button did nothing and said
 * nothing. Each outcome now has a name, and only `copied` may be reported as
 * a success.
 */

export type CopyOutcome = 'copied' | 'unavailable' | 'denied';

/** The slice of the Clipboard API this needs — injectable for tests. */
export interface ClipboardWriter {
  writeText?: (text: string) => Promise<void>;
}

function browserClipboard(): ClipboardWriter | undefined {
  // Typed as always-present by lib.dom, but undefined at runtime in an insecure context.
  return typeof navigator === 'undefined'
    ? undefined
    : (navigator as { clipboard?: ClipboardWriter }).clipboard;
}

export async function copyText(
  text: string,
  clipboard: ClipboardWriter | undefined = browserClipboard(),
): Promise<CopyOutcome> {
  if (typeof clipboard?.writeText !== 'function') return 'unavailable';
  try {
    await clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'denied';
  }
}

/** What to tell the user for each outcome. `what` names the thing copied. */
export function copyFeedback(
  outcome: CopyOutcome,
  what: string,
): { readonly variant: 'success' | 'error'; readonly title: string; readonly description?: string } {
  switch (outcome) {
    case 'copied':
      return { variant: 'success', title: `${what} copied` };
    case 'unavailable':
      return {
        variant: 'error',
        title: 'Clipboard not available',
        description:
          'This browser does not allow clipboard access here (it needs HTTPS or localhost). Select the text and press Ctrl+C / ⌘C, or use Download.',
      };
    case 'denied':
      return {
        variant: 'error',
        title: 'Copy was blocked',
        description:
          'The browser refused clipboard permission. Nothing was copied — select the text and press Ctrl+C / ⌘C, or use Download.',
      };
  }
}
