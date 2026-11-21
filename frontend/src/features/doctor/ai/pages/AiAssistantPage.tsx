import { useCallback, useEffect, useRef, useState } from 'react';

import { History, LayoutDashboard, MessageSquareX, Settings2 } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';

import { useDoctorProfile } from '@/app/providers';
import { EmptyState, Skeleton } from '@/components/feedback';
import { ContentHeader, PageContainer, PageSections, Stack } from '@/components/layout';
import { Breadcrumb, Button, Card, Drawer } from '@/components/ui';
import { usePatientDirectoryQuery } from '@/features/shared-domain/patient-identity';
import { useDisclosure } from '@/hooks/useDisclosure';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { routes } from '@/routes';
import { MedoraAiLogo } from '@/shared/components/branding';

import {
  useConversationsQuery,
  useCreateConversation,
  useDeleteConversationMutation,
  useUpdateConversationMutation,
} from '../api/useAiQueries';
import { AiDashboard } from '../components/AiDashboard';
import { AiSettingsDrawer } from '../components/AiSettingsDrawer';
import { ChatPanel } from '../components/ChatPanel';
import { ConversationListPanel } from '../components/ConversationListPanel';
import { useAiSettings } from '../hooks/useAiSettings';
import { AI_PROMPTS, type AiPrompt } from '../model/prompts';
import {
  AI_CONTEXT_META,
  GENERAL_CONTEXT,
  isAiContextMode,
  type AiContextMode,
  type AiConversation,
  type AiConversationContext,
  type ChatMessage,
} from '../model/types';

/**
 * AI Assistant — UX 2.5 workspace. URL contract: `?c=<conversationId>`
 * opens a chat; `?context=<mode>&patientId=&refId=` (sent by the "Ask AI"
 * entry points across Patient Profile / Records / Labs / Pharmacy) seeds
 * a new grounded conversation, honoring the auto-context setting. With no
 * params the page renders the AI dashboard (status, activity hub, prompt
 * library). Conversation history lives in the left column (a drawer under
 * lg); settings persist locally.
 */

function ChatSkeleton() {
  return (
    <Stack gap={4} aria-busy="true">
      <Skeleton className="h-10 w-56" />
      <Skeleton className="h-72 w-full rounded-surface" />
      <Skeleton className="h-16 w-full rounded-surface" />
    </Stack>
  );
}

export function AiAssistantPage() {
  const { profile } = useDoctorProfile();
  const isLg = useMediaQuery('(min-width: 1024px)');
  const [searchParams, setSearchParams] = useSearchParams();
  const settingsDrawer = useDisclosure();
  const historyDrawer = useDisclosure();

  const { settings, update: updateSetting, toggleFavoritePrompt } = useAiSettings();
  const conversationsQuery = useConversationsQuery();
  const createConversation = useCreateConversation();
  const updateMutation = useUpdateConversationMutation();
  const deleteMutation = useDeleteConversationMutation();

  const conversations = conversationsQuery.data ?? [];
  const activeId = searchParams.get('c');
  const activeConversation =
    activeId !== null ? (conversations.find((c) => c.id === activeId) ?? null) : null;

  const [pendingMessage, setPendingMessage] = useState<{
    readonly text: string;
    readonly promptId: string | null;
  } | null>(null);

  const openConversation = useCallback(
    (conversationId: string) => {
      setSearchParams({ c: conversationId }, { replace: true });
      historyDrawer.close();
    },
    [setSearchParams, historyDrawer],
  );

  const backToDashboard = useCallback(
    () => setSearchParams({}, { replace: true }),
    [setSearchParams],
  );

  /* ── Contextual entry points: seed a grounded conversation ────── */
  const seedHandledRef = useRef(false);
  // The patient a deep link names is resolved against the directory — the
  // doctor's own caseload when live — and the seed waits until it answers.
  const linkedPatientId = searchParams.get('patientId');
  const directory = usePatientDirectoryQuery({ enabled: linkedPatientId !== null });
  const directoryPatients = directory.data;
  const directorySettled = linkedPatientId === null || !directory.isPending;

  useEffect(() => {
    if (seedHandledRef.current) return;
    const contextParam = searchParams.get('context');
    if (contextParam === null || searchParams.get('c') !== null) return;
    if (!directorySettled) return;
    seedHandledRef.current = true;

    if (!isAiContextMode(contextParam) || contextParam === 'general' || !settings.autoContext) {
      backToDashboard(); // invalid or auto-context off — plain dashboard
      return;
    }
    const patientId = searchParams.get('patientId');
    const patient =
      patientId !== null
        ? (directoryPatients?.find((candidate) => candidate.id === patientId) ?? null)
        : null;
    const refId = searchParams.get('refId');
    const context: AiConversationContext = {
      mode: contextParam,
      patientId: patient?.id ?? null,
      patientName: patient?.name ?? null,
      refId,
    };
    const title = [AI_CONTEXT_META[contextParam].label, refId ?? patient?.name]
      .filter((part): part is string => typeof part === 'string')
      .join(' · ');
    const conversation = createConversation({ context, title, seedGreeting: true });
    openConversation(conversation.id);
  }, [
    searchParams,
    settings.autoContext,
    directorySettled,
    directoryPatients,
    createConversation,
    openConversation,
    backToDashboard,
  ]);

  /* ── Dashboard / list actions ──────────────────────────────────── */

  const newChat = useCallback(
    (pending?: { text: string; promptId: string | null }) => {
      const conversation = createConversation({ context: GENERAL_CONTEXT });
      if (pending) setPendingMessage(pending);
      openConversation(conversation.id);
    },
    [createConversation, openConversation],
  );

  const usePromptFromDashboard = useCallback(
    (prompt: AiPrompt) => newChat({ text: prompt.message, promptId: prompt.id }),
    [newChat],
  );

  const persistMessages = useCallback(
    (conversationId: string) => (messages: readonly ChatMessage[], titleHint: string | null) => {
      updateMutation.mutate({
        conversationId,
        patch: titleHint !== null ? { messages, title: titleHint } : { messages },
      });
    },
    [updateMutation],
  );

  const changeContextMode = useCallback(
    (conversation: AiConversation, mode: AiContextMode) => {
      updateMutation.mutate({
        conversationId: conversation.id,
        patch: {
          context: mode === 'general' ? GENERAL_CONTEXT : { ...conversation.context, mode },
        },
      });
    },
    [updateMutation],
  );

  const listPanel = (
    <ConversationListPanel
      conversations={conversations}
      activeId={activeId}
      loading={conversationsQuery.isPending}
      onOpen={(conversation) => openConversation(conversation.id)}
      onNew={() => newChat()}
      onRename={(conversationId, title) =>
        updateMutation.mutate({ conversationId, patch: { title } })
      }
      onToggleFavorite={(conversation) =>
        updateMutation.mutate({
          conversationId: conversation.id,
          patch: { favorite: !conversation.favorite },
        })
      }
      onDelete={(conversationId) => {
        deleteMutation.mutate(conversationId);
        if (conversationId === activeId) backToDashboard();
      }}
    />
  );

  const mainContent = (() => {
    // A just-created conversation may not be in the cached list yet —
    // keep the skeleton up while any (re)fetch is in flight.
    if (activeId !== null && activeConversation === null && conversationsQuery.isFetching) {
      return <ChatSkeleton />;
    }
    if (activeId !== null && activeConversation === null && !conversationsQuery.isPending) {
      return (
        <EmptyState
          icon={MessageSquareX}
          tone="ai"
          title="Conversation not found"
          description="It may have been deleted on this device."
          action={
            <Button variant="secondary" onClick={backToDashboard}>
              Back to AI dashboard
            </Button>
          }
        />
      );
    }
    if (activeConversation !== null) {
      return (
        <ChatPanel
          key={activeConversation.id}
          conversation={activeConversation}
          settings={settings}
          userName={profile.fullName || 'Doctor'}
          favoritePromptIds={settings.favoritePromptIds}
          onPersist={persistMessages(activeConversation.id)}
          onContextModeChange={(mode) => changeContextMode(activeConversation, mode)}
          onClearContext={() => changeContextMode(activeConversation, 'general')}
          onTogglePromptFavorite={toggleFavoritePrompt}
          pendingMessage={pendingMessage}
          onPendingConsumed={() => setPendingMessage(null)}
        />
      );
    }
    // First paint of a contextual entry (?context=…) before the seeding
    // effect navigates to the new conversation: avoid a dashboard flash.
    if (searchParams.get('context') !== null && settings.autoContext) {
      return <ChatSkeleton />;
    }
    return (
      <AiDashboard
        userName={profile.fullName || 'Doctor'}
        conversations={conversations}
        prompts={AI_PROMPTS}
        favoritePromptIds={settings.favoritePromptIds}
        onOpenConversation={(conversation) => openConversation(conversation.id)}
        onUsePrompt={usePromptFromDashboard}
        onTogglePromptFavorite={toggleFavoritePrompt}
        onNewChat={() => newChat()}
      />
    );
  })();

  return (
    <PageContainer width="2xl">
      <PageSections>
        <ContentHeader
          title="Medora AI"
          caption="Clinical questions, grounded in your patients, records, labs, and prescriptions."
          icon={MedoraAiLogo}
          tone="ai"
          breadcrumb={
            <Breadcrumb
              items={[{ label: 'Overview', href: routes.doctor.overview }, { label: 'Medora AI' }]}
            />
          }
          actions={
            <>
              {activeConversation !== null ? (
                <Button variant="ghost" leadingIcon={LayoutDashboard} onClick={backToDashboard}>
                  Dashboard
                </Button>
              ) : null}
              {!isLg ? (
                <Button variant="secondary" leadingIcon={History} onClick={historyDrawer.open}>
                  History
                </Button>
              ) : null}
              <Button variant="secondary" leadingIcon={Settings2} onClick={settingsDrawer.open}>
                Settings
              </Button>
            </>
          }
        />

        {/* Accent wash marks the AI workspace as a distinct surface
            (UX 1.5 provenance) without touching any behavior. */}
        <div className="rounded-surface bg-gradient-to-b from-accent-subtle via-background to-background p-3 md:p-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            {isLg ? (
              <div className="min-w-0 lg:col-span-4 xl:col-span-3">
                <Card padding="compact">{listPanel}</Card>
              </div>
            ) : null}
            <div className="min-w-0 lg:col-span-8 xl:col-span-9">{mainContent}</div>
          </div>
        </div>
      </PageSections>

      {!isLg ? (
        <Drawer
          open={historyDrawer.isOpen}
          onClose={historyDrawer.close}
          title="Conversation history"
          size="sm"
        >
          {listPanel}
        </Drawer>
      ) : null}

      <AiSettingsDrawer
        open={settingsDrawer.isOpen}
        onClose={settingsDrawer.close}
        settings={settings}
        onChange={updateSetting}
      />
    </PageContainer>
  );
}
