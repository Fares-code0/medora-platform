import { Image, StyleSheet, View } from 'react-native';

import { decorative } from '@/accessibility/a11y';
import { useTheme } from '@/theme';

import { Text } from './Text';

/**
 * Avatar.
 *
 * Falls back to initials rather than to a generic silhouette, because a
 * list of identical silhouettes is harder to scan than a list of
 * initials. The image is decorative — the name is always rendered
 * beside it, so a screen reader announcing "photo of…" adds nothing.
 *
 * `photoUrl` is optional and stays optional: a patient-safe doctor
 * projection (BE-04) may legitimately omit it, and a component that
 * assumes a URL exists is a component that crashes on the first doctor
 * who never uploaded one.
 */
export interface AvatarProps {
  readonly name: string;
  readonly photoUrl?: string | null;
  readonly size?: number;
  readonly testID?: string;
}

export function initialsOf(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

export function Avatar({ name, photoUrl, size = 44, testID }: AvatarProps) {
  const theme = useTheme();
  const shape = {
    width: size,
    height: size,
    borderRadius: size / 2,
    backgroundColor: theme.colors.primarySubtle,
    borderColor: theme.colors.border,
  };

  if (photoUrl) {
    return (
      <Image
        testID={testID}
        source={{ uri: photoUrl }}
        style={[styles.avatar, shape]}
        {...decorative}
      />
    );
  }

  return (
    <View testID={testID} style={[styles.avatar, styles.centered, shape]} {...decorative}>
      <Text variant="label" color="primary">
        {initialsOf(name)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: { borderWidth: 1, overflow: 'hidden' },
  centered: { alignItems: 'center', justifyContent: 'center' },
});
