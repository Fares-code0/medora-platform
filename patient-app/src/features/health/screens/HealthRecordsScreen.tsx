import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { StyleSheet, View } from 'react-native';

import { headingA11y } from '@/accessibility/a11y';
import {
  AsyncBoundary,
  Badge,
  Card,
  Divider,
  Icon,
  ListItem,
  Screen,
  Section,
  Text,
} from '@/components';
import { useT, useDateFormat } from '@/i18n';
import type { ProfileStackParamList } from '@/navigation/routes';
import { useTheme } from '@/theme';
import type { AllergySeverity, MedicationStatus } from '@/types/vocabularies';

import { ALLERGY_SEVERITY_KEY, HISTORY_KIND_KEY, MEDICATION_STATUS_KEY } from '../clinical-word';
import { ReleaseNotice } from '../components/ReleaseNotice';
import { useAllergies, useConditions, useHistory, useMedications } from '../hooks';

type Props = NativeStackScreenProps<ProfileStackParamList, 'HealthRecords'>;

/**
 * The health-records hub.
 *
 * ── Allergies come first, and severe ones are unmistakable ───────────
 * The doctor app pins a fixed allergy strip to the top of every patient
 * screen. That decision transfers: a severe allergy is the one piece of a
 * record that changes what a clinician does in an emergency, and a
 * patient showing their phone to a paramedic needs it at the top, in
 * error tone, with the word "Severe" written out (checklist J-02).
 *
 * Nothing on this screen is editable. These are clinician-owned records
 * (OOS-2), and the read-only presentation says who to talk to instead of
 * offering an edit that would fail.
 *
 * ── The chrome is translated; the clinical words are not (C-09) ──────
 *
 * Section titles, empty states and the "your clinic keeps these" notice
 * read the catalogue. The severity and status BADGES do not: "Severe",
 * "Active", "Discontinued" are the words a clinician chose, and this is
 * the screen a patient holds up to a paramedic. Getting one of them
 * subtly wrong in a language nobody on this project speaks natively is a
 * different class of mistake from a mistranslated button, and W-10 is
 * the row that signs it off. `messages/en.ts` states the rule.
 *
 * ── Every section renders the release gate, not just allergies ───────
 *
 * `model/types.ts` states that every record here carries a
 * `release: ReleaseState` and that the screens render all four outcomes
 * honestly. For a while only allergies did: conditions, medicines and
 * history dropped the field, so a `pending-review` condition rendered
 * identically to a released one and a patient had no way to know a
 * clinician had not signed it off. That is the failure `ReleaseNotice`'s
 * own docblock describes, arrived at by omission rather than by
 * filtering. `health-records.test.tsx` asserts each section separately,
 * so the next one added cannot quietly skip it.
 *
 * ── Sections follow J-01's order ─────────────────────────────────────
 *
 * Allergies, conditions, medicines, history, then the links out to labs,
 * prescriptions and documents. History used to sit *after* the links,
 * which put a navigation block in the middle of the record.
 *
 * **The history row was not following it — it was following nothing.**
 * It rendered `event.kind` raw, so a patient read
 * `hospitalization · 14 September 2026`: a lower-case wire value beside
 * a formatted date, in a list whose two neighbours had each capitalised
 * their own literal inline. `clinical-word.ts` is now the one place that
 * turns a clinical literal into the word on the screen, and the one
 * place the rule above is written as code rather than as prose.
 */

const SEVERITY_TONE: Record<AllergySeverity, 'error' | 'warning' | 'neutral'> = {
  severe: 'error',
  moderate: 'warning',
  mild: 'neutral',
};

const MEDICATION_TONE: Record<MedicationStatus, 'success' | 'neutral'> = {
  active: 'success',
  completed: 'neutral',
  discontinued: 'neutral',
};

export function HealthRecordsScreen({ navigation }: Props) {
  const theme = useTheme();
  const { formatLongDate } = useDateFormat();
  const t = useT();
  const allergies = useAllergies();
  const conditions = useConditions();
  const medications = useMedications();
  const history = useHistory();

  return (
    <Screen testID="health-records-screen">
      <Text variant="h1" {...headingA11y(t('health.title'))}>
        {t('health.title')}
      </Text>

      <Card tone="sunken">
        <Text variant="bodySm" color="textSecondary">
          {t('health.notice')}
        </Text>
      </Card>

      <Section title={t('health.allergies')}>
        <AsyncBoundary
          testID="health-allergies"
          query={allergies}
          isEmpty={(data) => data.length === 0}
          empty={{ icon: 'checkCircle', title: t('health.allergies.empty') }}
        >
          {(data) => (
            <View style={{ rowGap: theme.space[2] }}>
              {data.map((allergy) => (
                <Card
                  key={allergy.id}
                  testID={`allergy-${allergy.id}`}
                  tone={allergy.severity === 'severe' ? 'error' : 'default'}
                >
                  <ReleaseNotice state={allergy.release} />
                  <View style={[styles.row, { columnGap: theme.space[2] }]}>
                    {allergy.severity === 'severe' ? (
                      <Icon name="alert" size={18} color="error" />
                    ) : null}
                    <Text
                      variant="bodyStrong"
                      color={allergy.severity === 'severe' ? 'error' : 'textPrimary'}
                      style={styles.grow}
                    >
                      {allergy.allergen}
                    </Text>
                    <Badge
                      // Clinical vocabulary — see `clinical-word.ts`.
                      label={t(ALLERGY_SEVERITY_KEY[allergy.severity])}
                      tone={SEVERITY_TONE[allergy.severity]}
                    />
                  </View>
                  {allergy.reaction === null ? null : (
                    <Text variant="bodySm" color="textSecondary">
                      {allergy.reaction}
                    </Text>
                  )}
                </Card>
              ))}
            </View>
          )}
        </AsyncBoundary>
      </Section>

      <Section title={t('health.conditions')}>
        <AsyncBoundary
          testID="health-conditions"
          query={conditions}
          isEmpty={(data) => data.length === 0}
          empty={{ title: t('health.conditions.empty') }}
        >
          {(data) => (
            <View style={{ rowGap: theme.space[2] }}>
              {data.map((condition) => (
                <Card key={condition.id} testID={`condition-${condition.id}`}>
                  <ReleaseNotice state={condition.release} />
                  <Text variant="bodyStrong">{condition.name}</Text>
                  {condition.diagnosedOn === null ? null : (
                    <Text variant="bodySm" color="textSecondary">
                      {t('health.conditions.recorded', {
                        date: formatLongDate(condition.diagnosedOn),
                      })}
                    </Text>
                  )}
                </Card>
              ))}
            </View>
          )}
        </AsyncBoundary>
      </Section>

      <Section title={t('health.medications')}>
        <AsyncBoundary
          testID="health-medications"
          query={medications}
          isEmpty={(data) => data.length === 0}
          empty={{ title: t('health.medications.empty') }}
        >
          {(data) => (
            <View style={{ rowGap: theme.space[2] }}>
              {data.map((medication) => (
                <Card key={medication.id} testID={`medication-${medication.id}`}>
                  <ReleaseNotice state={medication.release} />
                  <View style={[styles.row, { columnGap: theme.space[2] }]}>
                    <Text variant="bodyStrong" style={styles.grow}>
                      {medication.name}
                    </Text>
                    <Badge
                      label={t(MEDICATION_STATUS_KEY[medication.status])}
                      tone={MEDICATION_TONE[medication.status]}
                    />
                  </View>
                  {/*
                    The dose and the schedule render together and always
                    have: either alone is unsafe to read, which is the rule
                    `PrescriptionsScreen` is tested for (J-07).
                  */}
                  <Text variant="bodySm" color="textSecondary">
                    {medication.dosage} · {medication.frequency}
                  </Text>
                  {medication.startedOn === null ? null : (
                    <Text variant="caption" color="textTertiary">
                      {t('health.medications.started', {
                        date: formatLongDate(medication.startedOn),
                      })}
                    </Text>
                  )}
                </Card>
              ))}
            </View>
          )}
        </AsyncBoundary>
      </Section>

      <Section title={t('health.history')} subtitle={t('health.history.subtitle')}>
        <AsyncBoundary
          testID="health-history"
          query={history}
          isEmpty={(data) => data.length === 0}
          empty={{ icon: 'clock', title: t('health.history.empty') }}
        >
          {(data) => (
            <View style={{ rowGap: theme.space[2] }}>
              {data.map((event) => (
                <Card key={event.id} testID={`history-${event.id}`}>
                  <ReleaseNotice state={event.release} />
                  <View style={[styles.row, { columnGap: theme.space[2] }]}>
                    <Text variant="bodyStrong" style={styles.grow}>
                      {event.title}
                    </Text>
                    {/* `clinical-word.ts` owns this rule — see its docblock. */}
                    <Badge label={t(HISTORY_KIND_KEY[event.kind])} tone="neutral" />
                  </View>
                  <Text variant="bodySm" color="textSecondary">
                    {formatLongDate(event.occurredOn)}
                  </Text>
                  {event.detail === null ? null : (
                    <Text variant="bodySm" color="textSecondary">
                      {event.detail}
                    </Text>
                  )}
                </Card>
              ))}
            </View>
          )}
        </AsyncBoundary>
      </Section>

      <Section title={t('health.more')} subtitle={t('health.more.subtitle')}>
        <Card padded={false}>
          <View style={{ paddingHorizontal: theme.space[4] }}>
            <ListItem
              title={t('health.labs.title')}
              icon="lab"
              testID="health-to-labs"
              onPress={() => navigation.navigate('LabResults')}
            />
            <Divider />
            <ListItem
              title={t('health.prescriptions.title')}
              icon="pill"
              testID="health-to-prescriptions"
              onPress={() => navigation.navigate('Prescriptions')}
            />
            <Divider />
            <ListItem
              title={t('health.visits.title')}
              icon="fileText"
              testID="health-to-visits"
              onPress={() => navigation.navigate('Visits')}
            />
            <Divider />
            <ListItem
              title={t('health.documents.title')}
              icon="folder"
              testID="health-to-documents"
              onPress={() => navigation.navigate('Documents')}
            />
          </View>
        </Card>
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  row: { alignItems: 'center', flexDirection: 'row' },
});
