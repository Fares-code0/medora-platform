import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Countdown timer for resend gates. Starts immediately, ticks to zero, and
 * exposes `restart()` to re-arm (e.g. after a successful resend).
 */
export interface Countdown {
  readonly remaining: number;
  readonly done: boolean;
  readonly restart: () => void;
}

export function useCountdown(seconds: number): Countdown {
  const [remaining, setRemaining] = useState(seconds);
  const intervalRef = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const tick = useCallback(() => {
    stop();
    intervalRef.current = window.setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          stop();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [stop]);

  useEffect(() => {
    tick();
    return stop;
  }, [tick, stop]);

  const restart = useCallback(() => {
    setRemaining(seconds);
    tick();
  }, [seconds, tick]);

  return { remaining, done: remaining === 0, restart };
}

/** Format seconds as M:SS for display. */
export function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m)}:${s.toString().padStart(2, '0')}`;
}
