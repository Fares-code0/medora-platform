/**
 * Mock latency — makes the fake backend feel real so loading/disabled states
 * are exercised. A single knob to swap for a real client later.
 */

const MIN_MS = 400;
const MAX_MS = 900;

export function withLatency<T>(value: T, min = MIN_MS, max = MAX_MS): Promise<T> {
  const ms = min + Math.random() * (max - min);
  return new Promise((resolve) => {
    setTimeout(() => resolve(value), ms);
  });
}

/** Reject after latency — for simulating server-side failures. */
export function rejectWithLatency(error: Error, min = MIN_MS, max = MAX_MS): Promise<never> {
  const ms = min + Math.random() * (max - min);
  return new Promise((_, reject) => {
    setTimeout(() => reject(error), ms);
  });
}
