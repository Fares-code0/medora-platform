import { useState } from 'react';

import { useNavigation, type NavigationProp } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { StyleSheet, View } from 'react-native';

import { headingA11y } from '@/accessibility/a11y';
import {
  AsyncBoundary,
  Button,
  Card,
  ConfirmSheet,
  ErrorState,
  Screen,
  Text,
  useToast,
} from '@/components';
import { NotLinkedNotice } from '@/features/health/components/NotLinkedNotice';
import { isPatientNotLinked } from '@/features/health/not-linked';
import { useDateFormat, useT } from '@/i18n';
import type { HomeStackParamList, RootStackParamList } from '@/navigation/routes';
import { useTheme } from '@/theme';

import { AiDisclaimer } from '../components/AiDisclaimer';
import { AiUnavailableNotice } from '../components/AiUnavailableNotice';
import { isAssistantUnavailable } from '../errors';
import { useAiConversations, useDeleteAiConversation } from '../hooks';
import type { AiConversationSummary } from '../model/types';

type Props = NativeStackScreenProps<HomeStackParamList, 'AiConversations'>;
type AiNavigation = NavigationProp<HomeStackParamList & RootStackParamList>;

/**
 * One assistant's conversations.
 *
 * The list is filtered to the mode the patient came in through: the two
 * assistants keep separate histories and this screen never shows the
 * other's. "New conversation" starts a draft (the conversation is created
 * on the first message, not here), and any existing one can be deleted
 * after a confirmation — a soft delete on the server, so it is gone from
 * this list immediately.
 *
 * The three refusals the list route can answer are each shown for what
 * they are, none as a generic failure: 409 `patient_not_linked` (the
 * personal assistant needs a linked account → the link notice), 503 (the
 * assistant is not available yet → the honest notice, with no "new
 * conversation" because nothing could be asked), and anything else (the
 * ordinary error state with Retry).
 */
export function AiConversationsScreen({ route }: Props) {
  const { mode } = route.params;
  const theme = useTheme();
  const t = useT();
  const toast = useToast();
  const { formatLongDate } = useDateFormat();
  const navigation = useNavigation<AiNavigation>();
  const conversations = useAiConversations(mode);
  const remove = useDeleteAiConversation();
  const [pendingDelete, setPendingDelete] = useState<AiConversationSummary | null>(null);

  const title = t(mode === 'personal' ? 'ai.mode.personal.title' : 'ai.mode.general.title');
  const label = (conversation: AiConversationSummary) =>
    conversation.title ??
    t('ai.conversations.untitled', { date: formatLongDate(conversation.createdAt) });

  const refusal = conversations.isError
    ? isPatientNotLinked(conversations.error)
      ? 'not-linked'
      : isAssistantUnavailable(conversations.error)
        ? 'unavailable'
        : null
    : null;

  const confirmDelete = () => {
    const target = pendingDelete;
    setPendingDelete(null);
    if (target === null) return;
    remove.mutate(target.id, {
      onError: () => toast.show(t('ai.conversations.delete.failed'), 'error'),
    });
  };

  return (
    <View style={[styles.fill, { backgroundColor: theme.colors.background }]}>
      <View style={{ padding: theme.screenGutter, paddingBottom: 0 }}>
        <AiDisclaimer mode={mode} />
      </View>

      <Screen
        testID="ai-conversations-screen"
        onRefresh={() => void conversations.refetch()}
        refreshing={conversations.isRefetching}
      >
        <Text variant="h1" {...headingA11y(title)}>
          {title}
        </Text>

        {refusal === 'not-linked' ? <NotLinkedNotice /> : null}
        {refusal === 'unavailable' ? <AiUnavailableNotice /> : null}

        {refusal === null ? (
          <>
            <Button
              testID="ai-new-conversation"
              label={t('ai.conversations.new')}
              icon="plus"
              fullWidth
              hint={t('ai.conversations.new.hint')}
              onPress={() => navigation.navigate('AiChat', { mode })}
            />

            <AsyncBoundary
              testID="ai-conversations-list"
              query={conversations}
              isEmpty={(data) => data.length === 0}
              empty={{
                icon: 'message',
                title: t('ai.conversations.empty.title'),
                body: t('ai.conversations.empty.body'),
              }}
            >
              {(data) => (
                <View style={{ rowGap: theme.space[2] }}>
                  {data.map((conversation) => (
                    <View
                      key={conversation.id}
                      style={[styles.row, { columnGap: theme.space[2] }]}
                    >
                      {/* A sibling, not a child: a pressable card collapses
                          its children into one accessible element, which
                          would hide the delete control from a screen reader. */}
                      <Card
                        testID={`ai-conversation-${conversation.id}`}
                        style={styles.grow}
                        onPress={() =>
                          navigation.navigate('AiChat', { mode, conversationId: conversation.id })
                        }
                        accessibilityLabel={label(conversation)}
                        accessibilityHint={t('ai.conversations.open.hint')}
                      >
                        <Text variant="bodyStrong" numberOfLines={2}>
                          {label(conversation)}
                        </Text>
                      </Card>
                      <Button
                        testID={`ai-conversation-delete-${conversation.id}`}
                        label={t('ai.conversations.delete')}
                        hint={t('ai.conversations.delete.a11y', { title: label(conversation) })}
                        tone="ghost"
                        size="sm"
                        icon="trash"
                        onPress={() => setPendingDelete(conversation)}
                      />
                    </View>
                  ))}
                </View>
              )}
            </AsyncBoundary>
          </>
        ) : null}

        {refusal === null && conversations.isError ? (
          <ErrorState error={conversations.error} onRetry={() => void conversations.refetch()} />
        ) : null}
      </Screen>

      <ConfirmSheet
        visible={pendingDelete !== null}
        title={t('ai.conversations.delete.title')}
        detail={t('ai.conversations.delete.body')}
        confirmLabel={t('ai.conversations.delete')}
        cancelLabel={t('ai.conversations.delete.keep')}
        tone="destructive"
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
        testID="ai-delete-confirm"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  grow: { flex: 1 },
  row: { alignItems: 'center', flexDirection: 'row' },
});
