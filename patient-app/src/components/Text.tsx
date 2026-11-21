import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';

import { useTheme } from '@/theme';
import type { ColorToken } from '@/theme/tokens';
import type { TypographyRole } from '@/theme/typography';

/**
 * The only text primitive.
 *
 * Two things it exists to prevent:
 *
 * 1. **A hardcoded colour.** `color` is a token name, not a string, so a
 *    screen cannot write `#0f172a` and end up with black ink on the dark
 *    theme's near-black page — the first item on §8's list of dark-mode
 *    failures.
 *
 * 2. **Double font scaling.** `buildTypography()` has already applied the
 *    OS font scale with a ceiling, so `allowFontScaling` is off by
 *    default here. Leaving RN's own scaling on would multiply the two and
 *    a patient on the largest accessibility size would get ~2.6x text
 *    that clips out of every card.
 */
export interface TextProps extends Omit<RNTextProps, 'style'> {
  readonly variant?: TypographyRole;
  readonly color?: ColorToken;
  readonly align?: TextStyle['textAlign'];
  readonly style?: TextStyle | readonly TextStyle[];
}

export function Text({
  variant = 'body',
  color = 'textPrimary',
  align,
  style,
  ...rest
}: TextProps) {
  const theme = useTheme();
  return (
    <RNText
      allowFontScaling={false}
      {...rest}
      style={[
        theme.typography[variant],
        { color: theme.colors[color] },
        align === undefined ? null : { textAlign: align },
        style,
      ]}
    />
  );
}
