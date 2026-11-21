import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MEDORA_INTRO_TIMING,
  markMedoraIntroPlayed,
  prefersReducedMotion,
  shouldPlayMedoraIntro,
} from './intro-session';
import { MedoraIntro } from './MedoraIntro';
import { MEDORA_TRACE_LENGTHS } from './medoraLogoPaths';

/**
 * The entrance overlay.
 *
 * Two things here are load-bearing and neither is visual. The overlay covers
 * the whole app, so if `onFinish` never fires the interface is unreachable —
 * every path out of the sequence (run to completion, skipped, reduced motion)
 * has to reach it. And each traced path has to carry its own dash length,
 * because a path that starts at `stroke-dashoffset: 0` is drawn in full on
 * the first frame: the mark appears instead of being written.
 */

describe('intro session state', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    delete document.documentElement.dataset.reduceMotion;
  });

  it('plays once per browsing session', () => {
    expect(shouldPlayMedoraIntro()).toBe(true);
    markMedoraIntroPlayed();
    expect(shouldPlayMedoraIntro()).toBe(false);
  });

  it('reads the in-app reduce-motion toggle, not only the OS preference', () => {
    expect(prefersReducedMotion()).toBe(false);
    document.documentElement.dataset.reduceMotion = 'on';
    expect(prefersReducedMotion()).toBe(true);
  });
});

describe('<MedoraIntro />', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.sessionStorage.clear();
    delete document.documentElement.dataset.reduceMotion;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('hands every trace its measured length so nothing is drawn on frame one', () => {
    const { container } = render(<MedoraIntro />);
    const traces = [...container.querySelectorAll('.medora-intro__trace')];

    expect(traces).toHaveLength(3);
    expect(traces.map((t) => t.getAttribute('style'))).toEqual([
      `--mi-trace-len: ${MEDORA_TRACE_LENGTHS.left};`,
      `--mi-trace-len: ${MEDORA_TRACE_LENGTHS.right};`,
      `--mi-trace-len: ${MEDORA_TRACE_LENGTHS.stem};`,
    ]);
  });

  it('reveals the app, then leaves and marks the session', () => {
    const onReveal = vi.fn();
    const onFinish = vi.fn();
    const { container } = render(<MedoraIntro onReveal={onReveal} onFinish={onFinish} />);

    act(() => void vi.advanceTimersByTime(MEDORA_INTRO_TIMING.full.reveal));
    expect(onReveal).toHaveBeenCalledTimes(1);
    expect(onFinish).not.toHaveBeenCalled();

    act(
      () =>
        void vi.advanceTimersByTime(
          MEDORA_INTRO_TIMING.full.total - MEDORA_INTRO_TIMING.full.reveal,
        ),
    );
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.medora-intro')).toBeNull();
    expect(shouldPlayMedoraIntro()).toBe(false);
  });

  it('runs the shortened timeline when motion is reduced', () => {
    document.documentElement.dataset.reduceMotion = 'on';
    const onFinish = vi.fn();
    render(<MedoraIntro onFinish={onFinish} />);

    act(() => void vi.advanceTimersByTime(MEDORA_INTRO_TIMING.reduced.total));
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('cuts to the exit on a key press', () => {
    const onReveal = vi.fn();
    const onFinish = vi.fn();
    const { container } = render(<MedoraIntro onReveal={onReveal} onFinish={onFinish} />);

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(container.querySelector('.medora-intro')).toHaveAttribute('data-skipping', 'true');
    expect(onReveal).toHaveBeenCalledTimes(1);

    act(() => void vi.advanceTimersByTime(240));
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.medora-intro')).toBeNull();
  });

  it('ignores the skip when it is turned off', () => {
    const { container } = render(<MedoraIntro allowSkip={false} />);

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(container.querySelector('.medora-intro')).not.toHaveAttribute('data-skipping');
  });
});

describe('the page under the intro (DEC-012)', () => {
  // The app is painted at full opacity beneath the overlay, and the overlay's
  // own fade is the reveal. Anything outside the overlay that starts at
  // opacity 0 is invisible to Largest Contentful Paint — Chrome does not count
  // a paint at opacity 0 as contentful — which is how every first visit used to
  // have no LCP. Read from disk, not imported: Vitest stubs CSS to an empty
  // string, so `?raw` comes back blank and the check would pass vacuously.
  const css = readFileSync(
    join(process.cwd(), 'src/shared/components/branding/MedoraIntro.css'),
    'utf8',
  );

  /** Selectors of plain style rules that set `opacity: 0`, keyframes excluded. */
  function transparentSelectors(source: string): string[] {
    let rules = source.replace(/\/\*[\s\S]*?\*\//g, '');
    // Drop @keyframes bodies: their `to { opacity: 0 }` is the overlay's exit.
    for (;;) {
      const at = rules.search(/@keyframes\b/);
      if (at < 0) break;
      let depth = 0;
      let end = rules.indexOf('{', at);
      for (; end < rules.length; end++) {
        if (rules[end] === '{') depth++;
        if (rules[end] === '}' && --depth === 0) break;
      }
      rules = rules.slice(0, at) + rules.slice(end + 1);
    }
    return [...rules.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, , body]) => /opacity:\s*0\s*(;|$)/m.test(body ?? ''))
      .flatMap(([, selectors]) => (selectors ?? '').split(',').map((s) => s.trim()));
  }

  it('starts nothing outside the overlay transparent', () => {
    const selectors = transparentSelectors(css);
    // The overlay's own pieces do start at 0 — that is the animation.
    expect(selectors.length).toBeGreaterThan(0);
    expect(selectors.filter((s) => !/\.medora-intro(?:__|\b)/.test(s))).toEqual([]);
  });

  it('would catch the wrapper this replaced', () => {
    expect(transparentSelectors('.medora-app-reveal { opacity: 0; }')).toEqual([
      '.medora-app-reveal',
    ]);
  });
});

describe('the exit reproduces the approved crossfade (NEW-22)', () => {
  // Before DEC-012 the app faded in (a) under the overlay fading out (o);
  // the overlay is the page's own background, so each frame was the page at
  // weight a·(1 − o). Now the overlay alone must carry that: 1 − a·(1 − o).
  const css = readFileSync(
    join(process.cwd(), 'src/shared/components/branding/MedoraIntro.css'),
    'utf8',
  );
  const globalsCss = readFileSync(join(process.cwd(), 'src/styles/globals.css'), 'utf8');

  /** cubic-bezier(0.4, 0, 0.2, 1) — `--mi-ease-appear`, and the old app fade's easing. */
  function ease(t: number): number {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const x = (s: number) => 3 * 0.4 * s * (1 - s) ** 2 + 3 * 0.2 * s * s * (1 - s) + s ** 3;
    const y = (s: number) => 3 * 1 * s * s * (1 - s) + s ** 3;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (x(mid) < t) lo = mid;
      else hi = mid;
    }
    return y((lo + hi) / 2);
  }

  function stops(name: string): { at: number; opacity: number }[] {
    const block = new RegExp(`@keyframes ${name} \\{([\\s\\S]*?)\\n\\}`).exec(css)?.[1] ?? '';
    return [...block.matchAll(/([\d.]+)% \{\s*opacity: ([\d.]+);/g)].map(([, at, opacity]) => ({
      at: Number(at) / 100,
      opacity: Number(opacity),
    }));
  }

  // [keyframes, overlay exit ms, the pre-DEC-012 app fade it stands in for]
  const VARIANTS = [
    ['mi-exit', 300, 320],
    ['mi-exit-skip', 220, 320],
  ] as const;

  it.each(VARIANTS)(
    '%s: every stop is 1 − a·(1 − o) (%i ms exit, %i ms app fade)',
    (name, exit, app) => {
      const found = stops(name);
      expect(found).toHaveLength(41);
      // The last stop is 0 by design: the overlay leaves there. On a full exit
      // the curve is at 0.002 by then; on a skip it is at 0.068 — the old app
      // was still fading for 100ms after a skipped overlay had gone, and holding
      // clicks that long to match it is not worth 7 % of a fade.
      expect(found.at(-1)).toEqual({ at: 1, opacity: 0 });
      for (const { at, opacity } of found.slice(0, -1)) {
        const t = at * exit;
        const overlay = 1 - ease(t / exit);
        const appOpacity = ease(t / app);
        expect(opacity).toBeCloseTo(1 - appOpacity * (1 - overlay), 3);
      }
    },
  );

  it('runs the curve with linear timing, so the stops are not eased twice', () => {
    expect(css).toMatch(
      /animation: mi-exit var\(--mi-exit-dur\) linear var\(--mi-exit-delay\) forwards;/,
    );
    expect(css).toMatch(/animation: mi-exit-skip 220ms linear forwards;/);
  });

  /*
   * Under reduced motion the intro cuts rather than fades. globals.css sets
   * every animation-duration to 0.01ms !important under the same query, and
   * nothing in MedoraIntro.css can outrank that — so this file sets only the
   * delay, and declares no duration that would never apply (a 240ms fade was
   * declared here, and measured in the browser at 0.01ms).
   */
  it('under prefers-reduced-motion, shortens the delay and leaves the cut to the global rule', () => {
    const reduced =
      /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    expect(reduced).toMatch(/\.medora-intro \{\s*--mi-exit-delay: 520ms;\s*\}/);
    expect(reduced).not.toMatch(/\.medora-intro \{[^}]*animation-(name|duration)/);
    expect(css).not.toMatch(/@keyframes mi-exit-(skip-)?reduced/);

    expect(globalsCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?animation-duration: 0\.01ms !important;/,
    );
    expect(MEDORA_INTRO_TIMING.reduced.reveal).toBe(520);
  });

  it('agrees with the JS timeline', () => {
    expect(css).toMatch(/--mi-exit-delay: 2620ms;/);
    expect(css).toMatch(/--mi-exit-dur: 300ms;/);
    expect(MEDORA_INTRO_TIMING.full.total - MEDORA_INTRO_TIMING.full.reveal).toBe(300);
  });
});
