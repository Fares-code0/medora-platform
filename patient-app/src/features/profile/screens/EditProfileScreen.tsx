import { useEffect, useRef, useState } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { View, type TextInputProps } from 'react-native';

import { headingA11y } from '@/accessibility/a11y';
import {
  AsyncBoundary,
  Button,
  Card,
  Input,
  ListItem,
  Screen,
  Section,
  Text,
  useToast,
} from '@/components';
import { SkeletonCard } from '@/components/feedback/Skeleton';
import { useFieldChain } from '@/components/form/useFieldChain';
import { useT, type MessageKey, type TranslateFn } from '@/i18n';
import { useTheme } from '@/theme';

import { profileKeys } from '../keys';
import type { ProfileFieldId } from '../model/types';
import { profileService } from '../service';

/**
 * What each field is called, by its id (C-09).
 *
 * The services still carry an English `label` and `ownedBy` — the
 * adapter's description of the row — but those are this app's words, not
 * the server's, so the screen renders the catalogue's instead. `ownedBy`
 * is matched on the three values the adapters write; anything else is
 * shown as given (lower-cased, as before).
 */
const FIELD_LABEL: Record<ProfileFieldId, MessageKey> = {
  fullName: 'profile.field.fullName',
  dateOfBirth: 'profile.field.dateOfBirth',
  bloodType: 'profile.field.bloodType',
  email: 'profile.field.email',
  phone: 'profile.field.phone',
  address: 'profile.field.address',
};

/**
 * "Kept by …" for a read-only field. The clinic fills the shared sentence;
 * the account and the patient get whole sentences of their own, because
 * Arabic cannot put «أنت» after «لدى» ("محفوظ لدى أنت") — it is «محفوظ لديك».
 */
function keptByLine(t: TranslateFn, ownedBy: string): string {
  if (ownedBy === 'Your clinic') {
    return t('profile.edit.keptBy', { owner: t('profile.field.owner.clinic') });
  }
  if (ownedBy === 'Your account') return t('profile.field.keptInAccount');
  if (ownedBy === 'You') return t('profile.field.keptByYou');
  return t('profile.edit.keptBy', { owner: ownedBy.toLowerCase() });
}

/**
 * Keyboard, autofill and capitalisation per field.
 *
 * Every non-email field used to get sentence capitalisation, which leaves
 * every word after the first lower-case — names and addresses want word
 * capitalisation. `autoComplete` and `textContentType` let the OS offer the
 * patient's own contact card, the fastest and least error-prone way to
 * fill an email or phone number.
 */
type FieldInputProps = Pick<
  TextInputProps,
  'autoCapitalize' | 'autoComplete' | 'autoCorrect' | 'keyboardType' | 'textContentType'
>;

const FIELD_INPUT: Record<ProfileFieldId, FieldInputProps> = {
  fullName: { autoCapitalize: 'words', autoComplete: 'name', textContentType: 'name' },
  email: {
    autoCapitalize: 'none',
    autoComplete: 'email',
    autoCorrect: false,
    keyboardType: 'email-address',
    textContentType: 'emailAddress',
  },
  phone: { autoComplete: 'tel', keyboardType: 'phone-pad', textContentType: 'telephoneNumber' },
  address: {
    autoCapitalize: 'words',
    autoComplete: 'street-address',
    textContentType: 'fullStreetAddress',
  },
  dateOfBirth: { autoCorrect: false },
  bloodType: { autoCapitalize: 'characters', autoCorrect: false },
};

/**
 * Personal details.
 *
 * ── Editable and read-only are separated, visibly ────────────────────
 * Fields the server marks `editable` become inputs. Fields it does not
 * become read-only rows naming who owns them. A patient who wants their
 * date of birth corrected is told to ask the clinic, which is true, rather
 * than being given a field that 403s.
 *
 * The client does not decide which is which. AD-2 does, and until it is
 * decided the server's flag is the only honest source (checklist P-03).
 *
 * Save and Cancel are both explicit — there is no autosave. An autosaving
 * form on a flaky mobile connection produces a half-saved profile and no
 * way to tell.
 */
export function EditProfileScreen() {
  const theme = useTheme();
  const t = useT();
  const toast = useToast();
  const queryClient = useQueryClient();

  const profile = useQuery({ queryKey: profileKeys.all, queryFn: () => profileService.get() });
  const [draft, setDraft] = useState<Partial<Record<ProfileFieldId, string>>>({});

  // Seed the draft once the profile arrives, and re-seed if it changes
  // underneath (a refetch after a save elsewhere).
  useEffect(() => {
    if (profile.data === undefined) return;
    const seeded: Partial<Record<ProfileFieldId, string>> = {};
    for (const field of profile.data.fields) {
      if (field.editable) seeded[field.id] = field.value ?? '';
    }
    setDraft(seeded);
  }, [profile.data]);

  // `save.isPending` only turns true after a re-render, so two presses in the
  // same tick would both reach `mutate`. A ref closes that window.
  const inFlight = useRef(false);
  const save = useMutation({
    mutationFn: (values: Partial<Record<ProfileFieldId, string>>) => profileService.update(values),
    onSettled: () => {
      inFlight.current = false;
    },
    onSuccess: () => {
      toast.show(t('profile.edit.saved'), 'success');
      void queryClient.invalidateQueries({ queryKey: profileKeys.all });
    },
    onError: () => {
      toast.show(t('profile.edit.saveFailed'), 'error');
    },
  });

  // Next moves down the editable fields; Done on the last one only closes
  // the keyboard. It never saves: saving is explicit (see above), and a
  // patient pressing Done to get the keyboard out of the way has not asked
  // for their profile to be written. The chain is given no `onSubmit` on
  // purpose — Save is the one path to `save.mutate`.
  const editableCount = profile.data?.fields.filter((field) => field.editable).length ?? 0;
  const chain = useFieldChain({ length: editableCount });

  return (
    <Screen testID="edit-profile-screen">
      <Text variant="h1" {...headingA11y(t('profile.edit.title'))}>
        {t('profile.edit.title')}
      </Text>

      <AsyncBoundary query={profile} testID="edit-profile" loading={<SkeletonCard />}>
        {(data) => {
          const editable = data.fields.filter((field) => field.editable);
          const readOnly = data.fields.filter((field) => !field.editable);
          return (
            <View style={{ rowGap: theme.space[5] }}>
              <Section title={t('profile.edit.editable')}>
                <View style={{ rowGap: theme.space[4] }}>
                  {editable.map((field, index) => (
                    <Input
                      key={field.id}
                      testID={`edit-profile-${field.id}`}
                      label={t(FIELD_LABEL[field.id])}
                      value={draft[field.id] ?? ''}
                      onChangeText={(value) =>
                        setDraft((current) => ({ ...current, [field.id]: value }))
                      }
                      {...FIELD_INPUT[field.id]}
                      {...chain.field(index)}
                    />
                  ))}
                </View>

                <View style={{ rowGap: theme.space[2] }}>
                  <Button
                    label={t('profile.edit.save')}
                    size="lg"
                    fullWidth
                    loading={save.isPending}
                    testID="edit-profile-save"
                    onPress={() => {
                      if (inFlight.current) return;
                      inFlight.current = true;
                      save.mutate(draft);
                    }}
                  />
                  <Button
                    label={t('action.cancel')}
                    tone="secondary"
                    size="lg"
                    fullWidth
                    testID="edit-profile-cancel"
                    onPress={() => {
                      const seeded: Partial<Record<ProfileFieldId, string>> = {};
                      for (const field of editable) seeded[field.id] = field.value ?? '';
                      setDraft(seeded);
                    }}
                  />
                </View>
              </Section>

              <Section
                title={t('profile.edit.clinicHeld')}
                subtitle={t('profile.edit.clinicHeldBody')}
              >
                <Card padded={false}>
                  <View style={{ paddingHorizontal: theme.space[4] }}>
                    {readOnly.map((field) => (
                      <ListItem
                        key={field.id}
                        testID={`edit-profile-readonly-${field.id}`}
                        title={t(FIELD_LABEL[field.id])}
                        value={field.value ?? '—'}
                        subtitle={keptByLine(t, field.ownedBy)}
                        readOnly
                      />
                    ))}
                  </View>
                </Card>
              </Section>
            </View>
          );
        }}
      </AsyncBoundary>
    </Screen>
  );
}
