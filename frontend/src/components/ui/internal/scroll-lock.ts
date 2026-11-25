/**
 * A reference-counted body scroll lock shared by every modal surface.
 *
 * Each dialog used to save `body.style.overflow` on open and write it back on
 * close. With two stacked (a Drawer and a confirm Modal over it) that breaks
 * whenever they do not close in exact reverse order: closing both in one
 * commit, or the Drawer first, has the last cleanup restore the `'hidden'` the
 * other one saved, and the page is left unable to scroll. Counting locks means
 * the original value is captured by the first lock and restored only when the
 * last one is released, whatever the order.
 */
let holders = 0;
let original = '';

/** Locks body scroll; the returned release is idempotent. */
export function lockBodyScroll(): () => void {
  if (holders === 0) {
    original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  holders += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders -= 1;
    if (holders === 0) document.body.style.overflow = original;
  };
}
