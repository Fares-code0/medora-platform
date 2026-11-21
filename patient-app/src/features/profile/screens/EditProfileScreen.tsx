import { useEffect, useState } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { View } from 'react-native';

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
import { useT } from '@/i18n';
import { useTheme } from '@/theme';

import { profileKeys } from '../keys';
import type { ProfileFieldId } from '../model/types';
import { profileService } from '../service';

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

  const save = useMutation({
    mutationFn: (values: Partial<Record<ProfileFieldId, string>>) => profileService.update(values),
    onSuccess: () => {
      toast.show(t('profile.edit.saved'), 'success');
      void queryClient.invalidateQueries({ queryKey: profileKeys.all });
    },
    onError: () => {
      toast.show(t('profile.edit.saveFailed'), 'error');
    },
  });

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
                  {editable.map((field) => (
                    <Input
                      key={field.id}
                      testID={`edit-profile-${field.id}`}
                      label={field.label}
                      value={draft[field.id] ?? ''}
                      onChangeText={(value) =>
                        setDraft((current) => ({ ...current, [field.id]: value }))
                      }
                      keyboardType={
                        field.id === 'email'
                          ? 'email-address'
                          : field.id === 'phone'
                            ? 'phone-pad'
                            : 'default'
                      }
                      autoCapitalize={field.id === 'email' ? 'none' : 'sentences'}
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
                    onPress={() => save.mutate(draft)}
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
                        title={field.label}
                        value={field.value ?? '—'}
                        subtitle={t('profile.edit.keptBy', {
                          owner: field.ownedBy.toLowerCase(),
                        })}
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
