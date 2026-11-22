import { getStateFromPath, type LinkingOptions } from '@react-navigation/native';
import { Linking } from 'react-native';

import { isSafeLinkPath } from './link-guard';
import { linking as baseLinking } from './linking';
import type { RootStackParamList } from './routes';

/**
 * Pending-link resume, and the once-only initial URL.
 *
 * ── The problem ──────────────────────────────────────────────────────
 * `RootNavigator` renders a different navigator per session status, so a
 * protected route (`Tabs`, `Booking`) does not exist while signed out,
 * booting or unconfirmed: React Navigation drops the link and nothing
 * brings it back after sign-in. And `BiometricLockGate` REPLACES the
 * navigator while locked, so `NavigationContainer` unmounts and, on
 * unlock, remounts and re-reads `Linking.getInitialURL()` — replaying a
 * cold-start link over whatever the patient had open.
 *
 * ── What this does ───────────────────────────────────────────────────
 * - Owns the OS `url` listener (it must outlive the container, which is
 *   unmounted while locked) and hands links to the container's own
 *   listener only when they can be shown.
 * - A link to a protected route that arrives while the session is not
 *   `authenticated`, or while locked, is held IN MEMORY (one slot, newest
 *   wins), and replayed once through the container's own listener after
 *   the session is authenticated and unlocked. Never persisted: it may
 *   carry an id. It is dropped on session end, after replay, and after
 *   `PENDING_LINK_TTL_MS`.
 * - Links valid while signed out (`Emergency`, `ResetPassword`) and links
 *   for other schemes are passed through exactly as before.
 * - Unsafe or unmatched links are ignored; they are never stored.
 * - The cold-start URL is read once; a remounted container gets nothing.
 */

export const PENDING_LINK_TTL_MS = 10 * 60 * 1000;

/** Routes that exist in the signed-out navigators. Everything else is protected. */
const SIGNED_OUT_ROUTES: ReadonlySet<string> = new Set(['Emergency', 'ResetPassword']);

export type LinkKind = 'signed-out-ok' | 'protected' | 'invalid' | 'foreign';

export function classifyLink(url: string | null | undefined): LinkKind {
  if (url === null || url === undefined) return 'invalid';
  const prefix = (baseLinking.prefixes ?? []).find((p) => url.startsWith(p));
  if (prefix === undefined) return 'foreign';
  const path = url.slice(prefix.length);
  if (!isSafeLinkPath(url) || !isSafeLinkPath(path)) return 'invalid';
  const state = getStateFromPath(path, baseLinking.config);
  const first = state?.routes[0]?.name;
  if (first === undefined) return 'invalid';
  return SIGNED_OUT_ROUTES.has(first) ? 'signed-out-ok' : 'protected';
}

type UrlListener = (url: string) => void;

export interface LinkSource {
  getInitialURL: () => Promise<string | null | undefined>;
  addEventListener: (type: 'url', handler: (event: { url: string }) => void) => {
    remove: () => void;
  };
}

export interface SessionSnapshot {
  readonly status: 'booting' | 'unauthenticated' | 'unconfirmed' | 'authenticated';
  readonly locked: boolean;
}

export interface LinkCoordinator {
  /** `linking` for `NavigationContainer`, with the once-only initial URL. */
  readonly linking: LinkingOptions<RootStackParamList>;
  /** Start owning the OS url events; returns the detach function. */
  attach: () => () => void;
  /** Report the session; ending a session discards any pending link. */
  setSession: (session: SessionSnapshot) => void;
  /** Replay the pending link if it can now be shown. True when replayed. */
  flush: () => boolean;
  hasPending: () => boolean;
}

export function createLinkCoordinator(
  options: { source?: LinkSource; now?: () => number } = {},
): LinkCoordinator {
  const source: LinkSource = options.source ?? Linking;
  const now = options.now ?? Date.now;

  let session: SessionSnapshot = { status: 'booting', locked: false };
  let listener: UrlListener | null = null;
  let pending: { url: string; at: number } | null = null;
  let initialConsumed = false;

  const canShow = () => session.status === 'authenticated' && !session.locked;
  const fresh = () => pending !== null && now() - pending.at <= PENDING_LINK_TTL_MS;

  function handleWarm(url: string): void {
    const kind = classifyLink(url);
    if (kind === 'invalid') return;
    if (kind === 'protected' && !(canShow() && listener !== null)) {
      pending = { url, at: now() };
      return;
    }
    // Signed-out-valid and foreign links behave as they always did: the
    // container's listener if one is mounted, otherwise nowhere to go.
    listener?.(url);
  }

  const wrapped: LinkingOptions<RootStackParamList> = {
    ...baseLinking,
    async getInitialURL() {
      if (initialConsumed) return undefined;
      initialConsumed = true;
      const url = await source.getInitialURL();
      const kind = classifyLink(url);
      if (kind === 'invalid') return undefined;
      if (kind === 'protected' && !canShow()) {
        pending = { url: url as string, at: now() };
        return undefined;
      }
      return url;
    },
    subscribe(next) {
      listener = next;
      return () => {
        if (listener === next) listener = null;
      };
    },
  };

  return {
    linking: wrapped,
    attach() {
      const subscription = source.addEventListener('url', ({ url }) => handleWarm(url));
      return () => subscription.remove();
    },
    setSession(next) {
      const ended =
        (session.status === 'authenticated' || session.status === 'unconfirmed') &&
        next.status === 'unauthenticated';
      session = next;
      if (ended) pending = null;
    },
    flush() {
      if (pending === null) return false;
      if (!fresh()) {
        pending = null;
        return false;
      }
      if (!canShow() || listener === null) return false;
      const { url } = pending;
      pending = null;
      listener(url);
      return true;
    },
    hasPending: () => pending !== null,
  };
}

/** The app's coordinator; `App.tsx` uses this one. */
export const linkCoordinator = createLinkCoordinator();
