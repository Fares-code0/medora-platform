import { useCallback, useEffect, useRef, useState } from 'react';

import { lockBodyScroll } from './scroll-lock';

/** Longer than the longest dialog exit (the 700ms customize panel). */
const EXIT_BACKSTOP_MS = 1200;

/**
 * The native-`<dialog>` lifecycle the Drawer, the Modal and the mobile nav
 * share, with room for an exit animation.
 *
 * The platform gives a modal dialog its focus trap, inert background and
 * focus return; this hook adds what it does not:
 *
 * - **Open** calls `showModal()` as soon as `open` turns true.
 * - **Close does not call `close()` straight away.** The caller renders its
 *   panel inside `<AnimatePresence onExitComplete={onExitComplete}>`; the
 *   dialog is closed only once the panel's exit has played, so the panel
 *   slides or fades out instead of vanishing with the dialog. While the exit
 *   runs, `closing` is true — the dialog carries `data-closing` and its scrim
 *   fades with it (globals.css). Reopening mid-exit simply re-enters: the
 *   dialog never closed.
 * - **Escape** is turned into a request (`onCancel`), never a native close,
 *   because a natively closed dialog is `display: none` and would cut the
 *   exit off. A caller that is not dismissible ignores the request.
 * - **Body scroll** is locked while open: the background is inert but some
 *   engines still scroll it.
 *
 * Where Framer Motion has no animation features loaded (the unit-test
 * renders), AnimatePresence completes an exit at once, so a closed dialog is
 * closed by the time the caller looks.
 */
export function useModalDialog(open: boolean, onCancel: () => void) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      setClosing(false);
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      setClosing(true);
    }
  }, [open]);

  const onExitComplete = useCallback(() => {
    const dialog = dialogRef.current;
    setClosing(false);
    if (dialog?.open) dialog.close();
  }, []);

  // A backstop, never the path: if an exit is interrupted and never reports
  // completion, the dialog still closes rather than leaving the page inert.
  useEffect(() => {
    if (!closing) return undefined;
    const timer = window.setTimeout(onExitComplete, EXIT_BACKSTOP_MS);
    return () => window.clearTimeout(timer);
  }, [closing, onExitComplete]);

  // Shared and reference-counted, so stacked dialogs closing in any order
  // (or in one commit) restore the body's original overflow.
  useEffect(() => {
    if (!open) return;
    return lockBodyScroll();
  }, [open]);

  // Held in a ref so a caller's inline handler does not re-bind the listener.
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handle = (event: Event) => {
      event.preventDefault();
      onCancelRef.current();
    };
    dialog.addEventListener('cancel', handle);
    return () => dialog.removeEventListener('cancel', handle);
  }, []);

  return { dialogRef, closing, onExitComplete };
}
