import { useState } from 'react';

import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { headingA11y } from '@/accessibility/a11y';
import { EmptyState, Text } from '@/components';
import { useT } from '@/i18n';
import type { HomeStackParamList, RootStackParamList } from '@/navigation/routes';
import { useTheme } from '@/theme';

import { useAiAvailability } from '../availability';
import { AiComposer } from '../components/AiComposer';
import { AiDisclaimer } from '../components/AiDisclaimer';
import { AiSafetyCard } from '../components/AiSafetyCard';
import { AiUnavailableNotice } from '../components/AiUnavailableNotice';
import type { AiTurnState } from '../model/types';

/**
 * The chat screen — checklist K-02's interface.
 *
 * ── The transcript is empty, and it stays empty ─────────────────────
 *
 * There is no conversation on this screen because there is nothing to
 * have one with. The message list renders its **empty state**; the
 * composer renders **disabled**, with the reason on the screen rather
 * than only in an accessibility hint.
 *
 * It would have been a few lines to seed a greeting — "Hello, how can I
 * help?" — and it is exactly the line this screen must not have. A
 * greeting from a party that cannot answer is a conversation the app has
 * started and cannot finish, and the next thing the patient types is
 * their symptoms.
 *
 * ── So where are the bubbles, the typing dots and the retry? ────────
 *
 * In `components/`, drawn, styled, translated, and rendered in every
 * state by `ai-states.test.tsx` directly. That is the honest home for a
 * designed state whose data does not exist: the component is real and
 * reviewable, and no screen fabricates an input to show it off. When
 * BE-14 and AD-4 land, this screen maps a real transcript onto
 * `AiMessageBubble` and sets `turnState` from a real request — the work
 * is the wiring, not the drawing.
 *
 * ── The composer draft is local and never leaves this screen ────────
 *
 * `draft` is `useState`. It is not persisted, not sent, and not restored:
 * a patient's account of their symptoms is PHI, this client writes no
 * PHI to disk (T-03), and K-07 forbids client-side conversation storage
 * by name. The composer is not editable today, so the state exists for
 * the wired version rather than for this one.
 *
 * ── Keyboard ────────────────────────────────────────────────────────
 *
 * `KeyboardAvoidingView` with the platform's own behaviour, so the
 * composer is not covered by the keyboard on iOS. The transcript is a
 * plain `ScrollView` rather than a `FlatList`: a list of one empty state
 * needs no virtualisation, and swapping it in when there are real
 * messages is a smaller change than unpicking a premature one.
 */
type AiNavigation = NavigationProp<HomeStackParamList & RootStackParamList>;

export function AiChatScreen() {
  const theme = useTheme();
  const t = useT();
  const navigation = useNavigation<AiNavigation>();
  const availability = useAiAvailability();

  const [draft, setDraft] = useState('');

  // One state, derived — never set by anything on this screen, because
  // nothing on this screen starts a turn.
  const turnState: AiTurnState = availability.connected ? 'idle' : 'unavailable';

  const title = t('ai.chat.title');

  return (
    <KeyboardAvoidingView
      style={[styles.fill, { backgroundColor: theme.colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Outside the scroll, so it cannot be scrolled away (K-03). */}
      <View style={{ padding: theme.screenGutter, paddingBottom: 0 }}>
        <AiDisclaimer />
      </View>

      <ScrollView
        testID="ai-chat-screen"
        style={styles.fill}
        contentContainerStyle={{
          padding: theme.screenGutter,
          rowGap: theme.space[4],
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Text variant="h2" {...headingA11y(title)}>
          {title}
        </Text>

        {availability.connected ? null : (
          <AiUnavailableNotice blockedBy={availability.blockedBy} />
        )}

        {/* The conversation-empty state (K-02). No seeded greeting —
            see the note above. */}
        <EmptyState
          testID="ai-chat-empty"
          icon="message"
          title={t('ai.chat.empty.title')}
          body={t('ai.chat.empty.body')}
        />

        <AiSafetyCard
          onEmergency={() => navigation.navigate('Emergency')}
          onFindCare={() =>
            navigation.navigate('Tabs', {
              screen: 'DiscoverTab',
              params: { screen: 'DiscoverRoot' },
            })
          }
        />
      </ScrollView>

      <AiComposer
        value={draft}
        onChangeText={setDraft}
        // Unreachable while `turnState` is `unavailable` — the composer
        // disables Send — and deliberately a no-op rather than a stub
        // that "would" send: there is nowhere to send it.
        onSend={() => undefined}
        state={turnState}
        onAttach={() => navigation.navigate('AiImage')}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
