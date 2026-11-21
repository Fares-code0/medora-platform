/**
 * Copy text to the clipboard — the one way the app does it.
 *
 * `navigator.clipboard` exists only in a secure context (HTTPS or
 * localhost), and a browser may refuse `writeText` by throwing rather than by
 * rejecting. Called bare, either case escapes the click handler as an
 * uncaught error and the user gets no feedback at all. Here both become a
 * rejected promise, so every caller's failure branch actually runs.
 */
export function copyText(text: string): Promise<void> {
  try {
    const clipboard = navigator.clipboard as Clipboard | undefined;
    if (clipboard === undefined) {
      return Promise.reject(new Error('The clipboard is not available here'));
    }
    return clipboard.writeText(text);
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
}
