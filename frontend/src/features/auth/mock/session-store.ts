import type { SessionUser } from '@/types/auth';

/**
 * Mock session persistence.
 * A fake bearer token plus a user snapshot — NO PHI, NO real credentials.
 * Remember Me chooses the storage medium: `localStorage` survives restarts,
 * `sessionStorage` dies with the tab. On login we clear the other medium so a
 * stale session never lingers. A real API swaps this for httpOnly-cookie /
 * silent-refresh semantics without touching the AuthProvider.
 */

const SESSION_KEY = 'medora.session';
const REMEMBER_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SESSION_MS = 12 * 60 * 60 * 1000; // 12 hours

interface StoredSession {
  readonly token: string;
  readonly user: SessionUser;
  readonly exp: number;
  readonly rememberMe: boolean;
}

function makeToken(): string {
  return `mock_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function safeParse(raw: string | null): StoredSession | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed.user || typeof parsed.exp !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function persistSession(user: SessionUser, rememberMe: boolean): void {
  const primary = rememberMe ? window.localStorage : window.sessionStorage;
  const other = rememberMe ? window.sessionStorage : window.localStorage;
  const payload: StoredSession = {
    token: makeToken(),
    user,
    exp: Date.now() + (rememberMe ? REMEMBER_MS : SESSION_MS),
    rememberMe,
  };
  try {
    other.removeItem(SESSION_KEY);
    primary.setItem(SESSION_KEY, JSON.stringify(payload));
  } catch {
    // Storage unavailable (private mode / quota) — session simply won't persist.
  }
}

/** Returns the persisted user if a non-expired session exists, else null. */
export function readSession(): SessionUser | null {
  try {
    const found =
      safeParse(window.localStorage.getItem(SESSION_KEY)) ??
      safeParse(window.sessionStorage.getItem(SESSION_KEY));
    if (!found) return null;
    if (found.exp <= Date.now()) {
      clearSession();
      return null;
    }
    return found.user;
  } catch {
    return null;
  }
}

/**
 * Mock silent token refresh (Phase 19). If a valid session exists, re-issue
 * the bearer token and slide the expiry window forward — the stand-in for
 * an httpOnly refresh-token exchange on app boot. Returns the refreshed
 * user, or null when there is nothing (or only an expired session) to
 * refresh.
 */
export function refreshSession(): SessionUser | null {
  try {
    const found =
      safeParse(window.localStorage.getItem(SESSION_KEY)) ??
      safeParse(window.sessionStorage.getItem(SESSION_KEY));
    if (!found) return null;
    if (found.exp <= Date.now()) {
      clearSession();
      return null;
    }
    persistSession(found.user, found.rememberMe);
    return found.user;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  try {
    window.localStorage.removeItem(SESSION_KEY);
    window.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Nothing to clear.
  }
}
