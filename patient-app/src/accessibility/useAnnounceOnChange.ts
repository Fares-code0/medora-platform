import { useEffect } from 'react';

import { Platform } from 'react-native';

import { announce } from './a11y';

/**
 * Speaks `message` when it appears or changes, on iOS only.
 *
 * `accessibilityLiveRegion` is an Android-only prop: on iOS a field error
 * that appears while focus stays elsewhere (a submit, a blur) is silent to
 * VoiceOver. Android already announces through the live region, so calling
 * `announce` there too would read every error twice.
 */
export function useAnnounceOnChange(message: string | undefined): void {
  useEffect(() => {
    if (Platform.OS !== 'ios' || message === undefined || message === '') return;
    announce(message);
  }, [message]);
}
