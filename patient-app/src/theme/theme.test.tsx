import { Text as RNText } from 'react-native';

import { renderWithProviders } from '@/test/render';

import { MIN_TOUCH_TARGET, radius, space } from './spacing';
import { buildTheme } from './ThemeProvider';
import { darkColors, lightColors } from './tokens';
import { buildTypography } from './typography';

/**
 * Theme tests.
 *
 * The contrast assertions are the interesting ones. Every failure §8 of
 * the brief lists — black text on a dark surface, white on white, a
 * disabled state that reads as enabled, a border that vanishes — is a
 * contrast ratio going below a threshold, and each is checked here in
 * BOTH palettes rather than eyeballed in one.
 */

/** WCAG 2.1 relative luminance. */
function luminance(hex: string): number {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0);
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

describe.each([
  ['light', lightColors],
  ['dark', darkColors],
])('%s palette contrast', (_name, colors) => {
  it('holds body text at AA (4.5:1) on surface and on the page', () => {
    expect(contrast(colors.textPrimary, colors.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.textPrimary, colors.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.textSecondary, colors.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.textTertiary, colors.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it('holds the filled-button foreground against every filled tone', () => {
    // This is the "white text on a light surface" failure: in dark mode
    // every filled tone is light, so `textInverse` inverts with them.
    for (const tone of [colors.primary, colors.error, colors.success, colors.accent]) {
      expect(contrast(colors.textInverse, tone)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('holds control boundaries at 3:1 on all three grounds (WCAG 1.4.11)', () => {
    for (const ground of [colors.surface, colors.background, colors.surfaceSunken]) {
      expect(contrast(colors.borderStrong, ground)).toBeGreaterThanOrEqual(3);
    }
  });

  it('holds status text at AA on its own subtle background', () => {
    // Only the opaque light-mode subtles can be measured this way; the
    // dark palette's subtles are rgba over the surface.
    if (!colors.successSubtle.startsWith('#')) return;
    expect(contrast(colors.success, colors.successSubtle)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.warning, colors.warningSubtle)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.error, colors.errorSubtle)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.info, colors.infoSubtle)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps disabled text distinguishable from enabled text', () => {
    expect(colors.textDisabled).not.toBe(colors.textPrimary);
    expect(contrast(colors.textPrimary, colors.surface)).toBeGreaterThan(
      contrast(colors.textDisabled, colors.surface),
    );
  });
});

describe('palette structure', () => {
  it('defines exactly the same tokens in both themes', () => {
    expect(Object.keys(lightColors).sort()).toEqual(Object.keys(darkColors).sort());
  });

  it('gives every token a value in both themes', () => {
    for (const [key, value] of Object.entries(lightColors)) {
      expect(value).toBeTruthy();
      expect(darkColors[key as keyof typeof darkColors]).toBeTruthy();
    }
  });
});

describe('buildTheme', () => {
  it('resolves light and dark to different palettes', () => {
    expect(buildTheme('light').colors.background).toBe(lightColors.background);
    expect(buildTheme('dark').colors.background).toBe(darkColors.background);
  });

  it('carries the scale tokens', () => {
    const theme = buildTheme('light');
    expect(theme.space).toBe(space);
    expect(theme.radius).toBe(radius);
    expect(theme.minTouchTarget).toBe(MIN_TOUCH_TARGET);
  });
});

describe('typography', () => {
  it('keeps body text at or above the 16pt mobile floor', () => {
    const type = buildTypography();
    expect(type.body.fontSize).toBeGreaterThanOrEqual(16);
    // Not the doctor app's 13px enterprise-dense body.
    expect(type.body.fontSize).not.toBe(13);
  });

  it('never drops below the 12pt caption floor', () => {
    const type = buildTypography();
    for (const style of Object.values(type)) {
      expect(style.fontSize ?? 0).toBeGreaterThanOrEqual(12);
    }
  });

  it('gives every role a line height above its font size', () => {
    for (const style of Object.values(buildTypography())) {
      expect(style.lineHeight ?? 0).toBeGreaterThan(style.fontSize ?? 0);
    }
  });
});

describe('ThemeProvider', () => {
  it('renders children under an explicit mode', () => {
    const light = renderWithProviders(<RNText>themed</RNText>, { mode: 'light' });
    expect(light.getByText('themed')).toBeTruthy();

    const dark = renderWithProviders(<RNText>themed</RNText>, { mode: 'dark' });
    expect(dark.getByText('themed')).toBeTruthy();
  });
});
