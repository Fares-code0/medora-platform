import { PixelRatio, StyleSheet } from 'react-native';

import { Button } from '@/components/Button';
import { Text } from '@/components/Text';
import { renderWithProviders } from '@/test/render';

import { buildTypography, criticalTextStyle, fontScale } from './typography';

/**
 * Text scaling (checklist S-03). Ordinary text is capped at 1.6x so bounded
 * layouts do not clip; critical text (emergency) scales to 2.0x; buttons
 * grow in height rather than clip.
 */
function withFontScale<T>(scale: number, run: () => T): T {
  const spy = jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(scale);
  try {
    return run();
  } finally {
    spy.mockRestore();
  }
}

describe('font scale ceilings', () => {
  it('caps ordinary text at 1.6x', () => {
    withFontScale(2.5, () => {
      expect(fontScale()).toBe(1.6);
      expect(buildTypography().body.fontSize).toBe(Math.round(16 * 1.6));
    });
  });

  it('lets critical text grow to 2.0x and no further', () => {
    withFontScale(2.5, () => {
      const body = buildTypography().body;
      expect(criticalTextStyle(body).fontSize).toBe(33);
      expect(criticalTextStyle(body).lineHeight).toBe(46);
    });
  });

  it('is a no-op for critical text at or below the ordinary ceiling', () => {
    withFontScale(1.3, () => {
      const body = buildTypography().body;
      expect(criticalTextStyle(body)).toBe(body);
    });
  });

  it('renders <Text critical> larger than <Text> at a large OS size', () => {
    withFontScale(2, () => {
      const view = renderWithProviders(
        <>
          <Text testID="plain">a</Text>
          <Text critical testID="crit">
            a
          </Text>
        </>,
      );
      const size = (id: string): number =>
        (StyleSheet.flatten(view.getByTestId(id).props.style) as { fontSize: number }).fontSize;
      expect(size('plain')).toBe(26);
      expect(size('crit')).toBe(33);
    });
  });
});

describe('buttons grow rather than clip', () => {
  it('uses minHeight, never a fixed height, for every size', () => {
    for (const size of ['sm', 'md', 'lg'] as const) {
      const view = renderWithProviders(
        <Button label="x" onPress={jest.fn()} size={size} testID="b" />,
      );
      const flat = StyleSheet.flatten(view.getByTestId('b').props.style) as Record<string, unknown>;
      expect(flat.minHeight).toBeGreaterThanOrEqual(44);
      expect(flat.height).toBeUndefined();
    }
  });

  it('wraps the emergency label instead of truncating it', () => {
    const view = renderWithProviders(
      <Button label="Call Emergency services" tone="emergency" onPress={jest.fn()} />,
    );
    expect(view.getByText('Call Emergency services').props.numberOfLines).toBeUndefined();
    const other = renderWithProviders(<Button label="Save" onPress={jest.fn()} />);
    expect(other.getByText('Save').props.numberOfLines).toBe(1);
  });
});
