import { useMemo, useState } from 'react';

import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { StyleSheet, View } from 'react-native';

import { headingA11y } from '@/accessibility/a11y';
import { Button, Card, Chip, Screen, Section, Text } from '@/components';
import { useT, type MessageKey } from '@/i18n';
import type { HomeStackParamList, RootStackParamList } from '@/navigation/routes';
import { useTheme } from '@/theme';

import { useAiAvailability } from '../availability';
import { AiDisclaimer } from '../components/AiDisclaimer';
import { AiResultPlaceholder } from '../components/AiResultPlaceholder';
import { AiStepper } from '../components/AiStepper';
import { AiUnavailableNotice } from '../components/AiUnavailableNotice';
import { SymptomPicker } from '../components/SymptomPicker';
import {
  DURATION_OPTIONS,
  INTAKE_TOTAL_STEPS,
  SYMPTOM_OPTIONS,
  type DurationId,
} from '../content/intake';

/**
 * Structured symptom intake — checklist K-02's symptom context.
 *
 * ── What genuinely works here, and what deliberately does not ───────
 *
 * The three-step form works, end to end, because **a form is not an
 * assistant**. Selecting symptoms, choosing a duration and stepping
 * forward and back are local UI state; there is no more inference in it
 * than in a checkbox. It is worth building now: it is the part a patient
 * interacts with, it is where the accessibility and RTL work lives, and
 * it does not depend on a single thing that is blocked.
 *
 * What does not work is the last step, and that is the point of the
 * screen. Step 3 renders `AiResultPlaceholder`, which states plainly
 * that nothing has read the answers and nothing has been sent anywhere,
 * echoes the patient's own selections back so they can use them at a
 * desk or on the phone, and offers the two routes that are real: find a
 * clinician, or open Emergency.
 *
 * ── Why there is no red-flag matching in this file ──────────────────
 *
 * It would be four lines to check the selection for "chest pain" and
 * "breathless" and show a warning, and K-04 forbids exactly that:
 * "**Classification is server-side. The client must not be the only
 * guard.**" A bundled matcher is one that cannot be corrected on a phone
 * that has already shipped, and — worse — one a patient can be
 * *reassured* by when it does not fire. The Emergency route is therefore
 * unconditional and always present, offered to everyone at every step,
 * which is the guarantee a matcher cannot give.
 *
 * ── Nothing is persisted ────────────────────────────────────────────
 *
 * The selections live in `useState` and are gone with the screen. What a
 * patient says about their own body is PHI and this client writes no PHI
 * to disk (T-03); K-07 additionally requires server-side persistence and
 * forbids the local kind by name.
 */
type AiNavigation = NavigationProp<HomeStackParamList & RootStackParamList>;

export function AiSymptomsScreen() {
  const theme = useTheme();
  const t = useT();
  const navigation = useNavigation<AiNavigation>();
  const availability = useAiAvailability();

  const [step, setStep] = useState(1);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [duration, setDuration] = useState<DurationId | null>(null);

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** The patient's own words, read back. Never an interpretation. */
  const summary = useMemo(() => {
    const chosen = SYMPTOM_OPTIONS.filter((option) => selected.has(option.id)).map((option) =>
      t(option.labelKey as MessageKey),
    );
    const when = DURATION_OPTIONS.find((option) => option.id === duration);
    return when === undefined ? chosen : [...chosen, t(when.labelKey)];
  }, [selected, duration, t]);

  const canAdvance = step === 1 ? selected.size > 0 : step === 2 ? duration !== null : false;
  const title = t('ai.intake.title');

  const goToCare = () =>
    navigation.navigate('Tabs', { screen: 'DiscoverTab', params: { screen: 'DiscoverRoot' } });

  return (
    <View style={[styles.fill, { backgroundColor: theme.colors.background }]}>
      {/* Outside the ScrollView, so it cannot be scrolled away (K-03). */}
      <View style={{ padding: theme.screenGutter, paddingBottom: 0 }}>
        <AiDisclaimer />
      </View>

      <Screen testID="ai-symptoms-screen">
        <Text variant="h1" {...headingA11y(title)}>
          {title}
        </Text>

        <AiStepper progress={{ step, total: INTAKE_TOTAL_STEPS }} />

        {availability.connected ? null : (
          <AiUnavailableNotice blockedBy={availability.blockedBy} />
        )}

        {step === 1 ? (
          <Section title={t('ai.intake.what.title')} subtitle={t('ai.intake.what.subtitle')}>
            <SymptomPicker selected={selected} onToggle={toggle} />
          </Section>
        ) : null}

        {step === 2 ? (
          <Section title={t('ai.intake.when.title')} subtitle={t('ai.intake.when.subtitle')}>
            <View style={[styles.grid, { columnGap: theme.space[2], rowGap: theme.space[2] }]}>
              {DURATION_OPTIONS.map((option) => (
                <Chip
                  key={option.id}
                  testID={`ai-duration-${option.id}`}
                  label={t(option.labelKey)}
                  selected={duration === option.id}
                  onPress={() => setDuration(option.id)}
                />
              ))}
            </View>
          </Section>
        ) : null}

        {step === INTAKE_TOTAL_STEPS ? (
          <Section title={t('ai.intake.review.title')}>
            <AiResultPlaceholder
              summary={summary}
              onFindCare={goToCare}
              onEmergency={() => navigation.navigate('Emergency')}
            />
          </Section>
        ) : null}

        <View style={[styles.row, { columnGap: theme.space[3] }]}>
          {step > 1 ? (
            <Button
              testID="ai-intake-back"
              label={t('action.back')}
              tone="secondary"
              icon="back"
              onPress={() => setStep((current) => current - 1)}
              style={styles.grow}
            />
          ) : null}
          {step < INTAKE_TOTAL_STEPS ? (
            <Button
              testID="ai-intake-next"
              label={t('ai.intake.next')}
              tone="primary"
              disabled={!canAdvance}
              onPress={() => setStep((current) => current + 1)}
              style={styles.grow}
            />
          ) : null}
        </View>

        {/* Present at every step, never conditional on what was picked.
            See the K-04 note in this file's header. */}
        <Card tone="sunken">
          <Text variant="bodySm" color="textTertiary">
            {t('ai.intake.alwaysEmergency')}
          </Text>
          <Button
            testID="ai-intake-emergency"
            label={t('ai.safety.emergency.action')}
            tone="emergency"
            icon="alert"
            fullWidth
            onPress={() => navigation.navigate('Emergency')}
            hint={t('ai.safety.emergency.hint')}
          />
        </Card>
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  grow: { flex: 1 },
  row: { flexDirection: 'row' },
});
