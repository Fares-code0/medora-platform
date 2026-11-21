import { useRef, useState } from 'react';

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewInstance,
} from 'react-native';

import { headingA11y } from '@/accessibility/a11y';
import { Button, Icon, Screen, Text } from '@/components';
import { useT } from '@/i18n';
import type { AuthStackParamList } from '@/navigation/routes';
import { useTheme } from '@/theme';

import { markOnboardingSeen } from '../seen';
import { ONBOARDING_SLIDES } from '../slides';

type Props = NativeStackScreenProps<AuthStackParamList, 'Onboarding'>;

/**
 * The onboarding carousel — checklist E-02.
 *
 * ── Emergency is one tap away from every slide ───────────────────────
 *
 * This is the design constraint, not the carousel. E-01 put emergency
 * access above the fold on Welcome precisely so a person in crisis is
 * never reading marketing copy, and putting a three-slide carousel in
 * front of Welcome would have undone that on the one launch where the
 * patient has no idea where anything is.
 *
 * So the top row carries **Emergency and Skip together**, on every slide,
 * with Emergency first. Skip is the row E-02 asks for; Emergency is the
 * row N-01's guarantee needs. Neither scrolls away — they sit outside the
 * pager, not inside it.
 *
 * ── Skipping is an answer, not a deferral ────────────────────────────
 *
 * Skip and Finish both call `markOnboardingSeen`. An app that re-asks
 * after a skip has not accepted the answer, and E-02's own criterion is
 * "never shown twice" rather than "never completed twice".
 *
 * ── Why a paging ScrollView and not a library ────────────────────────
 *
 * Three slides, one axis, no gestures beyond the platform's own. A pager
 * dependency would be a native module for a horizontal scroll the
 * platform already does, and `docs/ARCHITECTURE.md`'s dependency rule
 * asks for the capability that requires one. There isn't one here.
 */
export function OnboardingScreen({ navigation }: Props) {
  const theme = useTheme();
  const t = useT();
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const scroller = useRef<ScrollViewInstance | null>(null);

  const lastIndex = ONBOARDING_SLIDES.length - 1;
  const isLast = index === lastIndex;

  const finish = () => {
    markOnboardingSeen();
    navigation.replace('Welcome');
  };

  const goTo = (next: number) => {
    setIndex(next);
    scroller.current?.scrollTo({ x: next * width, animated: true });
  };

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const page = Math.round(event.nativeEvent.contentOffset.x / Math.max(width, 1));
    if (page !== index) setIndex(page);
  };

  return (
    <Screen edges={['top', 'bottom']} scroll={false} padded={false} testID="onboarding-screen">
      <View
        style={[
          styles.topRow,
          { paddingHorizontal: theme.screenGutter, paddingTop: theme.space[2] },
        ]}
      >
        <Button
          label="Emergency"
          tone="ghost"
          size="sm"
          testID="onboarding-emergency"
          hint="Opens emergency guidance. It does not place a call."
          onPress={() => navigation.navigate('Emergency')}
        />
        <Button
          label={t('onboarding.skip')}
          tone="ghost"
          size="sm"
          testID="onboarding-skip"
          onPress={finish}
        />
      </View>

      <ScrollView
        ref={scroller}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScroll}
        testID="onboarding-pager"
        style={styles.grow}
      >
        {ONBOARDING_SLIDES.map((slide) => (
          <View
            key={slide.id}
            testID={`onboarding-slide-${slide.id}`}
            style={[
              styles.slide,
              { width, paddingHorizontal: theme.screenGutter, rowGap: theme.space[4] },
            ]}
          >
            <Icon name={slide.icon} size={56} color="primary" />
            <Text variant="h1" align="center" {...headingA11y(t(slide.titleKey))}>
              {t(slide.titleKey)}
            </Text>
            <Text variant="body" color="textSecondary" align="center">
              {t(slide.bodyKey)}
            </Text>
          </View>
        ))}
      </ScrollView>

      <View
        style={[
          styles.footer,
          {
            paddingHorizontal: theme.screenGutter,
            paddingBottom: theme.space[4],
            rowGap: theme.space[4],
          },
        ]}
      >
        <View
          style={[styles.dots, { columnGap: theme.space[2] }]}
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={t('onboarding.progress', {
            position: index + 1,
            total: ONBOARDING_SLIDES.length,
          })}
        >
          {ONBOARDING_SLIDES.map((slide, position) => (
            <View
              key={slide.id}
              testID={`onboarding-dot-${position === index ? 'active' : 'inactive'}`}
              style={{
                width: theme.space[2],
                height: theme.space[2],
                borderRadius: theme.radius.pill,
                backgroundColor:
                  position === index ? theme.colors.primary : theme.colors.borderStrong,
              }}
            />
          ))}
        </View>

        <Button
          label={isLast ? t('onboarding.finish') : t('onboarding.next')}
          fullWidth
          testID="onboarding-next"
          onPress={() => (isLast ? finish() : goTo(index + 1))}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  dots: { alignItems: 'center', flexDirection: 'row', justifyContent: 'center' },
  footer: { justifyContent: 'flex-end' },
  grow: { flex: 1 },
  slide: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  topRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
});
