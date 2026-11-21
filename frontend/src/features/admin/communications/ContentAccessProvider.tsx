import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { ReactNode } from 'react';

import { useAuth } from '@/app/providers';

import { grantForConversation, isLive, type ContentGrant } from './communications';
import { useCloseAccessMutation, useOpenAccessMutation } from './communications.queries';
import type { ContentAccessCategory } from './communications.types';

/**
 * The content-access gate (ADM-06B sub-project B · Task 9 · UX §3.6).
 *
 * The sibling of `admin/phi/PhiAccessProvider`, over the same shared
 * `audited-access` module, granting per-conversation rather than
 * per-record-field. Two properties carry over from that gate unchanged:
 *
 *  1. **The grant is never persisted.** It lives in `useState` and nowhere
 *     else — not localStorage, not sessionStorage, not the query cache. "I
 *     justified this an hour ago" is not a justification for now, so a
 *     grant must not survive a reload, a new tab, or a re-login.
 *
 *  2. **It fails closed.** `isLiveFor` returns `false` for a null grant, a
 *     grant scoped to a different conversation, or one whose window has
 *     elapsed. In a module whose purpose is restraint, an error that
 *     reveals content is worse than one that hides it.
 *
 * The audit write happens first: `request` only sets the grant inside the
 * mutation's success continuation, after `openAccess` has resolved. If the
 * write fails, `request`'s promise rejects and no grant is ever created —
 * an access that failed to log is an access that did not happen.
 *
 * **A second `request` while one grant is still live closes the first.**
 * This provider holds at most one grant, so without this the earlier
 * entry's id becomes unreachable the instant `ref` is overwritten — nothing
 * could ever close it, and it would sit open in the access log forever.
 * `request` therefore closes the outgoing entry as `'incomplete'` (the
 * abandoned-read outcome, same as the expiry timer's) before it writes the
 * new one, so the log reads in the order the events actually happened.
 */

export interface ContentAccessValue {
  readonly grant: ContentGrant | null;
  /** The access-log entry id — the "ref #" the viewer banner shows. */
  readonly ref: string | null;
  request: (input: {
    conversationId: string;
    category: ContentAccessCategory;
    reason: string;
  }) => Promise<void>;
  release: (outcome: 'completed' | 'incomplete') => void;
  isLiveFor: (conversationId: string) => boolean;
}

const ContentAccessContext = createContext<ContentAccessValue | null>(null);

export function ContentAccessProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const open = useOpenAccessMutation();
  const close = useCloseAccessMutation();

  const [grant, setGrant] = useState<ContentGrant | null>(null);
  const [ref, setRef] = useState<string | null>(null);

  const request = useCallback(
    async (input: {
      conversationId: string;
      category: ContentAccessCategory;
      reason: string;
    }) => {
      // Requesting again while a grant is still live abandons that read —
      // the same situation the expiry timer and a mid-view error land in —
      // so it gets the same outcome. Closed and cleared *before* the new
      // `openAccess` write below, for two reasons: the log has to read in
      // the order these things actually happened, and if the new write
      // then throws, the provider is left holding no grant at all rather
      // than a stale one pointing at an entry that's already closed.
      const outgoing = ref;
      if (outgoing !== null) {
        try {
          await close.mutateAsync({ id: outgoing, outcome: 'incomplete' });
        } catch {
          // A failed close must not block a justified new access — an
          // administrator's request cannot be held hostage by an unrelated
          // write failure. The abandoned entry simply stays open, which is
          // visible in the log as exactly what happened here.
        }
        setGrant(null);
        setRef(null);
      }

      const entry = await open.mutateAsync({
        conversationId: input.conversationId,
        category: input.category,
        reason: input.reason,
        actor: user?.name ?? 'Administrator',
      });
      // Only now — the access is on the record. `mutateAsync` above throws
      // on a rejected write (including the service's own re-validation of
      // the reason), so nothing below this line runs unless the log entry
      // already exists.
      setGrant(
        grantForConversation(
          input.conversationId,
          `Conversation ${input.conversationId}`,
          input.category,
          input.reason,
          Date.now(),
        ),
      );
      setRef(entry.id);
    },
    [open, close, ref, user],
  );

  const release = useCallback(
    (outcome: 'completed' | 'incomplete') => {
      if (ref !== null) close.mutate({ id: ref, outcome });
      setGrant(null);
      setRef(null);
    },
    [ref, close],
  );

  // The window closes on its own. Each grant gets its own timer here, and
  // the cleanup clears that exact timer id — not a ref shared across
  // renders, which would leak the superseded timer instead of cancelling it
  // when a new grant replaces an old one. This codebase hit that bug in
  // Phase 10.
  useEffect(() => {
    if (grant === null) return undefined;
    const ms = Math.max(grant.expiresAt - Date.now(), 0);
    const id = window.setTimeout(() => {
      release('incomplete');
    }, ms);
    return () => {
      window.clearTimeout(id);
    };
  }, [grant, release]);

  const isLiveFor = useCallback(
    (conversationId: string) =>
      grant !== null && grant.subjectId === conversationId && isLive(grant, Date.now()),
    [grant],
  );

  const value = useMemo<ContentAccessValue>(
    () => ({ grant, ref, request, release, isLiveFor }),
    [grant, ref, request, release, isLiveFor],
  );

  return (
    <ContentAccessContext.Provider value={value}>{children}</ContentAccessContext.Provider>
  );
}

export function useContentAccess(): ContentAccessValue {
  const context = useContext(ContentAccessContext);
  if (!context) throw new Error('useContentAccess must be used within ContentAccessProvider');
  return context;
}
