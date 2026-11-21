import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

import { useToast } from '@/app/providers';

import type { DashboardWidgetSelection } from './useDashboardWidgetSelection';

/**
 * The editing behaviour every customizable Overview shares, over a selection
 * from `useDashboardWidgetSelection`: the customize drawer and its draft,
 * removal from a widget's own ⋯ menu with an Undo toast, and where keyboard
 * focus goes when the control it was on disappears.
 *
 * The drawer edits a DRAFT, never the dashboard. Two configurations exist
 * while it is open:
 *
 * - the saved selection (`selection.activeIds`) — what the Overview renders
 *   and what storage holds. Only Done changes it.
 * - the draft — a copy taken from the saved selection when the drawer opens.
 *   The checkboxes read and write it; nothing else does, and it is never
 *   written to storage.
 *
 * Done commits the draft (one `selection.replace`, which persists before the
 * dashboard re-renders) and closes. Every other way out — Cancel, the close
 * button, Escape, a click on the scrim, the page unmounting on navigation —
 * drops the draft, so the next open starts again from what was saved.
 *
 * The page renders the controls; this hook owns what they do, so the Doctor
 * and Admin Overviews behave identically rather than similarly.
 */
export interface DashboardEditor<TId extends string> {
  /** The drawer is open (a draft exists). */
  readonly customizing: boolean;
  /** Opens the drawer with a fresh draft copied from the saved selection. */
  readonly openCustomize: () => void;
  /** Done: commits the draft as the saved selection, persists it, closes. */
  readonly commitCustomize: () => void;
  /** Cancel / close: discards the draft. The dashboard never changed. */
  readonly cancelCustomize: () => void;
  /** Whether a widget is checked in the draft. */
  readonly isDraftActive: (id: TId) => boolean;
  /** How many widgets the draft holds. */
  readonly draftCount: number;
  /** The drawer's checkbox handler — edits the draft only. */
  readonly toggle: (id: TId, active: boolean) => void;
  /** The drawer's "Remove all" — empties the draft only. */
  readonly clearDraft: () => void;
  /** The ⋯ menu's "Remove from dashboard": removes, toasts, offers Undo. */
  readonly removeFromMenu: (id: TId) => void;
  /** Attach to the header's customize button (rendered while not empty). */
  readonly headerCustomizeRef: RefObject<HTMLButtonElement>;
  /** Attach to the empty state's customize button. */
  readonly emptyCustomizeRef: RefObject<HTMLButtonElement>;
}

export function useDashboardEditor<TId extends string>(
  selection: DashboardWidgetSelection<TId>,
  titleOf: (id: TId) => string,
): DashboardEditor<TId> {
  const { activeIds, remove, restore, replace } = selection;
  const { toast } = useToast();

  /*
   * The draft lives in state (the drawer renders from it) and in a ref (the
   * handlers read it). The ref is what makes Done idempotent: the first
   * commit takes the draft and nulls the ref in the same tick, so a second
   * click — or Enter held on the button — finds nothing to commit, even
   * before React has re-rendered the drawer closed.
   */
  const [draft, setDraftState] = useState<readonly TId[] | null>(null);
  const draftRef = useRef<readonly TId[] | null>(null);
  const setDraft = useCallback((next: readonly TId[] | null) => {
    draftRef.current = next;
    setDraftState(next);
  }, []);
  const customizing = draft !== null;

  const headerCustomizeRef = useRef<HTMLButtonElement>(null);
  const emptyCustomizeRef = useRef<HTMLButtonElement>(null);
  const refocusAfterRemoval = useRef(false);

  const isEmpty = activeIds.length === 0;

  /*
   * A widget removed from its own ⋯ menu takes the focused menu trigger with
   * it, and focus would fall back to <body>. Send it to the customize control
   * instead — the header button, or the empty state's once nothing is left —
   * which is also where a user would go to bring the widget back.
   */
  useEffect(() => {
    if (!refocusAfterRemoval.current) return;
    refocusAfterRemoval.current = false;
    (isEmpty ? emptyCustomizeRef : headerCustomizeRef).current?.focus();
  }, [activeIds, isEmpty]);

  /*
   * The drawer is opened from whichever customize button is on screen, and
   * closing it restores focus there — unless that button is gone, which is
   * exactly what happens when the first widget is added from the empty state.
   * Re-target after close so focus lands on the control that now exists. This
   * effect runs after the Drawer's own, so it wins over the native restore.
   */
  const wasCustomizing = useRef(false);
  useEffect(() => {
    if (customizing) {
      wasCustomizing.current = true;
      return;
    }
    if (!wasCustomizing.current) return;
    wasCustomizing.current = false;
    (isEmpty ? emptyCustomizeRef : headerCustomizeRef).current?.focus();
  }, [customizing, isEmpty]);

  const removeFromMenu = useCallback(
    (id: TId) => {
      const index = activeIds.indexOf(id);
      refocusAfterRemoval.current = true;
      remove(id);
      toast({
        variant: 'info',
        title: `${titleOf(id)} removed from your dashboard`,
        description: 'Add it back any time from Customize.',
        action: {
          label: 'Undo',
          onClick: () => {
            restore(id, index);
          },
        },
      });
    },
    [activeIds, remove, restore, toast, titleOf],
  );

  const toggle = useCallback(
    (id: TId, active: boolean) => {
      const current = draftRef.current;
      if (current === null) return;
      if (active === current.includes(id)) return;
      // A new array every time: the draft is never mutated in place, and it
      // never shares an array with the saved selection it was copied from.
      setDraft(active ? [...current, id] : current.filter((entry) => entry !== id));
    },
    [setDraft],
  );

  const clearDraft = useCallback(() => {
    if (draftRef.current === null || draftRef.current.length === 0) return;
    setDraft([]);
  }, [setDraft]);

  const openCustomize = useCallback(() => {
    if (draftRef.current !== null) return;
    setDraft([...activeIds]);
  }, [activeIds, setDraft]);

  const cancelCustomize = useCallback(() => {
    setDraft(null);
  }, [setDraft]);

  const commitCustomize = useCallback(() => {
    const pending = draftRef.current;
    if (pending === null) return;
    setDraft(null);
    const saved = replace(pending);
    if (!saved) {
      // The dashboard shows the new selection for this visit, but storage
      // refused it — say so rather than let a reload silently undo it.
      toast({
        variant: 'warning',
        title: 'Your dashboard could not be saved',
        description:
          'The widgets you chose are showing now, but this browser did not store them, so they will reset when the page reloads.',
      });
    }
  }, [replace, setDraft, toast]);

  const isDraftActive = useCallback((id: TId) => draft?.includes(id) ?? false, [draft]);
  const draftCount = draft?.length ?? 0;

  return {
    customizing,
    openCustomize,
    commitCustomize,
    cancelCustomize,
    isDraftActive,
    draftCount,
    toggle,
    clearDraft,
    removeFromMenu,
    headerCustomizeRef,
    emptyCustomizeRef,
  };
}
