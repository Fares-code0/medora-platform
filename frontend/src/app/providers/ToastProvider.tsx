import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';

import { AnimatePresence, m } from 'framer-motion';

import {
  Toast,
  type ToastAction,
  type ToastData,
  type ToastVariant,
} from '@/components/feedback/Toast';

import {
  ANNOUNCEMENT_TTL_MS,
  ANNOUNCER_ATTRIBUTE,
  announcementText,
  politenessOf,
  type Politeness,
} from './toast-announcer';

/**
 * Toast system — DESIGN_SYSTEM.md §8.23.
 * Imperative API (`useToast`) + top-right host (stack max 3, newest on
 * top). Success/info auto-dismiss 5s, warning 8s, errors persist until
 * dismissed. Timers pause while a toast is hovered or focused. Entrance:
 * fade + translateY(-8px); exit: fade + height collapse.
 *
 * **Announcement (F-18).** Two persistent, visually hidden live regions —
 * polite for success, info and warning; assertive for errors, which is what
 * the old per-toast `role="alert"` meant — receive each toast's title and
 * description as a node of its own. They exist from mount, so the first
 * toast is not lost to a region being created at the same moment as its
 * content; each message is appended (`aria-relevant="additions"`) rather
 * than replacing the last, so two toasts in quick succession are both read
 * and a repeated message is read again; and expired nodes are removed
 * silently. The visual stack is not a live region at all: the dismiss and
 * action buttons are never part of what is read, and dismissing is not
 * announced. This replaces a polite `aria-live` stack whose every toast was
 * itself a `status`/`alert` region — one live region nested in another.
 *
 * Not verified with a screen reader: the structure follows the ARIA
 * live-region model, and NVDA/VoiceOver behaviour is still to be checked.
 */

export type { ToastVariant };

export interface ToastOptions {
  readonly variant: ToastVariant;
  readonly title: string;
  readonly description?: string;
  /** Optional single action (e.g. "Undo") — DS §8.23. */
  readonly action?: ToastAction;
}

interface ToastContextValue {
  readonly toast: (options: ToastOptions) => void;
  readonly dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DURATION_MS: Record<ToastVariant, number | null> = {
  success: 5_000,
  info: 5_000,
  warning: 8_000,
  error: null, // errors persist until dismissed (DS 8.23)
};

const MAX_VISIBLE = 3;

interface Announcement {
  readonly id: string;
  readonly politeness: Politeness;
  readonly text: string;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<readonly ToastData[]>([]);
  const [announcements, setAnnouncements] = useState<readonly Announcement[]>([]);
  const timers = useRef(new Map<string, number>());
  const announcementTimers = useRef(new Set<number>());

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const startTimer = useCallback(
    (id: string, variant: ToastVariant) => {
      const duration = DURATION_MS[variant];
      if (duration === null) return;
      timers.current.set(
        id,
        window.setTimeout(() => dismiss(id), duration),
      );
    },
    [dismiss],
  );

  const pauseTimer = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const announce = useCallback((id: string, options: ToastOptions) => {
    setAnnouncements((current) => [
      ...current,
      { id, politeness: politenessOf(options.variant), text: announcementText(options) },
    ]);
    const timer = window.setTimeout(() => {
      announcementTimers.current.delete(timer);
      setAnnouncements((current) => current.filter((entry) => entry.id !== id));
    }, ANNOUNCEMENT_TTL_MS);
    announcementTimers.current.add(timer);
  }, []);

  // Every timer dies with the provider: a dismiss or expiry that fired later
  // would set state on an unmounted tree — and, in a test, into a torn-down page.
  useEffect(() => {
    const pending = announcementTimers.current;
    const dismissals = timers.current;
    return () => {
      pending.forEach((timer) => window.clearTimeout(timer));
      pending.clear();
      dismissals.forEach((timer) => window.clearTimeout(timer));
      dismissals.clear();
    };
  }, []);

  const toast = useCallback(
    (options: ToastOptions) => {
      const id = crypto.randomUUID();
      setToasts((current) => [{ id, ...options }, ...current].slice(0, MAX_VISIBLE));
      startTimer(id, options.variant);
      announce(id, options);
    },
    [startTimer, announce],
  );

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {(['polite', 'assertive'] as const).map((politeness) => (
        <div
          key={politeness}
          {...{ [ANNOUNCER_ATTRIBUTE]: politeness }}
          aria-live={politeness}
          aria-atomic="false"
          aria-relevant="additions"
          className="sr-only"
        >
          {announcements
            .filter((entry) => entry.politeness === politeness)
            .map((entry) => (
              <p key={entry.id}>{entry.text}</p>
            ))}
        </div>
      ))}
      <div className="fixed start-1/2 top-4 z-toast flex w-[360px] max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-col rtl:translate-x-1/2 sm:start-auto sm:end-4 sm:translate-x-0 sm:rtl:translate-x-0">
        <AnimatePresence initial={false}>
          {toasts.map((t) => (
            <m.div
              key={t.id}
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, height: 0, marginBottom: 0, transition: { duration: 0.15 } }}
              transition={{ duration: 0.2, ease: [0, 0, 0.2, 1] }}
              className="mb-2 overflow-hidden"
              onMouseEnter={() => pauseTimer(t.id)}
              onMouseLeave={() => startTimer(t.id, t.variant)}
              onFocusCapture={() => pauseTimer(t.id)}
              onBlurCapture={() => startTimer(t.id, t.variant)}
            >
              <Toast toast={t} onDismiss={() => dismiss(t.id)} />
            </m.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
