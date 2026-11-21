import { act, render } from '@testing-library/react-native';
import { AccessibilityInfo, Text } from 'react-native';

import { useMotionDuration, useReducedMotion, useReducedMotionSetting } from './useReducedMotion';

/**
 * The reduce-motion switch — checklist S-06, C-10.
 *
 * Motion sensitivity is a vestibular condition, not a preference, and a
 * healthcare app is more likely than most to be used by someone who has
 * one. The hook had **0% branch coverage**, and its branches are the
 * whole design: a three-state answer where the third state is the one
 * that matters.
 *
 * `AccessibilityInfo.isReduceMotionEnabled()` is a promise, so the answer
 * is not there on the first render. Defaulting to `false` for that frame
 * starts an animation and then stops it — a flash of motion shown to
 * precisely the person who asked not to see any. `null` means "not known
 * yet", and every caller treats it as "do not animate".
 */

/** Renders a hook's value into a testID, so a test can read it. */
function probe<T>(useHook: () => T) {
  const values: T[] = [];
  function Probe() {
    const value = useHook();
    values.push(value);
    return <Text testID="value">{String(value)}</Text>;
  }
  const view = render(<Probe />);
  return { ...view, values, latest: () => values[values.length - 1] };
}

type ReduceMotionListener = (enabled: boolean) => void;

/** Captures the `reduceMotionChanged` listener the hook subscribes with. */
function captureListener() {
  const listeners: ReduceMotionListener[] = [];
  const remove = jest.fn();
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((_event, listener) => {
    listeners.push(listener);
    return { remove };
  });
  return {
    emit: (enabled: boolean) =>
      act(() => {
        for (const listener of [...listeners]) listener(enabled);
      }),
    remove,
    count: () => listeners.length,
  };
}

afterEach(() => {
  jest.restoreAllMocks();
  // `setup.ts` installs the never-resolving default for every other
  // suite; restoring the spies above removes it, so put it back.
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockImplementation(() => new Promise<boolean>(() => undefined));
});

describe('the three states', () => {
  it('starts at null — not known yet, rather than not enabled', async () => {
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockImplementation(() => new Promise<boolean>(() => undefined));

    const view = probe(useReducedMotionSetting);
    await act(async () => undefined);

    expect(view.latest()).toBeNull();
  });

  it('resolves to what the OS says', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);

    const view = probe(useReducedMotionSetting);
    await act(async () => undefined);

    expect(view.latest()).toBe(true);
  });

  it('resolves to false when the OS says motion is fine', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);

    const view = probe(useReducedMotionSetting);
    await act(async () => undefined);

    expect(view.latest()).toBe(false);
  });

  it('does not set state after unmounting', async () => {
    // The `active` flag. Without it a promise resolving after the screen
    // is gone is a React warning in development and a leak in a list
    // that mounts and unmounts rows.
    let resolve: (value: boolean) => void = () => undefined;
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockImplementation(() => new Promise<boolean>((r) => (resolve = r)));
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});

    const view = probe(useReducedMotionSetting);
    view.unmount();
    await act(async () => {
      resolve(true);
    });

    expect(errors).not.toHaveBeenCalled();
  });
});

describe('unknown counts as reduced (S-06)', () => {
  it('suppresses motion before the answer arrives', async () => {
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockImplementation(() => new Promise<boolean>(() => undefined));

    const view = probe(useReducedMotion);
    await act(async () => undefined);

    // The frame that would otherwise carry the flash of motion.
    expect(view.latest()).toBe(true);
  });

  it('allows motion only once the OS has said false', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);

    const view = probe(useReducedMotion);
    await act(async () => undefined);

    expect(view.latest()).toBe(false);
  });
});

describe('useMotionDuration', () => {
  it('collapses a duration to zero rather than shortening it', async () => {
    // Zero, not "shorter". A 60 ms animation is still an animation to
    // someone with a vestibular condition.
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);

    const view = probe(() => useMotionDuration(240));
    await act(async () => undefined);

    expect(view.latest()).toBe(0);
  });

  it('passes the duration through when motion is allowed', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);

    const view = probe(() => useMotionDuration(240));
    await act(async () => undefined);

    expect(view.latest()).toBe(240);
  });
});

describe('it follows the switch being flipped mid-session', () => {
  it('reacts to reduceMotionChanged without a remount', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    const events = captureListener();

    const view = probe(useReducedMotion);
    await act(async () => undefined);
    expect(view.latest()).toBe(false);

    events.emit(true);

    // A patient turns it on in Settings *because* something moved. The
    // next screen must already honour it.
    expect(view.latest()).toBe(true);
  });

  it('unsubscribes on unmount', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    const events = captureListener();

    const view = probe(useReducedMotion);
    await act(async () => undefined);
    expect(events.count()).toBe(1);

    view.unmount();

    expect(events.remove).toHaveBeenCalledTimes(1);
  });
});
