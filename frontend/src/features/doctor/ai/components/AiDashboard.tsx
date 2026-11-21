import { ArrowRight } from 'lucide-react';

import { Section, Stack } from '@/components/layout';
import { Fact, FactGrid, StatusBadge } from '@/components/patterns';
import { Badge, Button, Card } from '@/components/ui';
import { MedoraAiLogo } from '@/shared/components/branding';
import { relativeDayLabel } from '@/utils/dates';

import type { AiPrompt } from '../model/prompts';
import {
  AI_CONTEXT_META,
  AI_MODEL_NAME,
  AI_MODEL_VERSION,
  type AiConversation,
} from '../model/types';

import { PromptCards } from './PromptCards';

/**
 * AI dashboard — the landing state when no conversation is open: welcome
 * + system status, recent conversations, recent analyses (contextual
 * chats), favorite prompts, and the full suggestion library. Rendered in
 * the accent AI container language per the provenance rule (UX 1.5).
 */
export interface AiDashboardProps {
  userName: string;
  conversations: readonly AiConversation[];
  prompts: readonly AiPrompt[];
  favoritePromptIds: readonly string[];
  onOpenConversation: (conversation: AiConversation) => void;
  onUsePrompt: (prompt: AiPrompt) => void;
  onTogglePromptFavorite: (promptId: string) => void;
  onNewChat: () => void;
}

function ConversationRow({
  conversation,
  onOpen,
}: {
  conversation: AiConversation;
  onOpen: (conversation: AiConversation) => void;
}) {
  const mode = AI_CONTEXT_META[conversation.context.mode];
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(conversation)}
        className="flex w-full items-center justify-between gap-3 rounded-surface px-2 py-2 text-start transition-colors duration-fast hover:bg-surface-sunken"
      >
        <span className="min-w-0">
          <span className="block truncate text-body-sm font-medium text-text-primary">
            {conversation.title}
          </span>
          <span className="text-caption text-text-tertiary">
            {String(conversation.messages.length)} message
            {conversation.messages.length === 1 ? '' : 's'} ·{' '}
            {relativeDayLabel(conversation.updatedAt)}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <Badge variant="neutral">{mode.label}</Badge>
          <ArrowRight aria-hidden="true" className="h-4 w-4 text-text-tertiary" strokeWidth={1.75} />
        </span>
      </button>
    </li>
  );
}

export function AiDashboard({
  userName,
  conversations,
  prompts,
  favoritePromptIds,
  onOpenConversation,
  onUsePrompt,
  onTogglePromptFavorite,
  onNewChat,
}: AiDashboardProps) {
  const recent = conversations.slice(0, 5);
  const analyses = conversations
    .filter((conversation) => conversation.context.mode !== 'general')
    .slice(0, 5);
  const favorites = prompts.filter((prompt) => favoritePromptIds.includes(prompt.id));

  return (
    <Stack gap={8}>
      {/* Welcome + status */}
      <Card className="border-accent bg-accent-subtle">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span
              aria-hidden="true"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-pill border border-accent bg-surface text-accent"
            >
              <MedoraAiLogo className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-h5 font-semibold text-text-primary">
                Good to see you, {userName}
              </h2>
              <p className="mt-1 text-body-sm text-text-secondary">
                Ask about patients, records, labs, or medications — every answer is a draft for
                your clinical judgment, never a decision.
              </p>
            </div>
          </div>
          <Button variant="ai" leadingIcon={MedoraAiLogo} onClick={onNewChat}>
            New chat
          </Button>
        </div>
        <FactGrid className="mt-4 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="Status">
            <StatusBadge status="normal" label="Operational" />
          </Fact>
          <Fact label="Model">{AI_MODEL_NAME}</Fact>
          <Fact label="Version">
            <span className="font-mono">{AI_MODEL_VERSION}</span>
          </Fact>
          <Fact label="Data boundary">Mock — nothing leaves this device</Fact>
        </FactGrid>
      </Card>

      {/* Activity hub */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <Section title="Recent conversations" headingAs="h2">
            {recent.length === 0 ? (
              <p className="text-body-sm text-text-tertiary">No conversations yet.</p>
            ) : (
              <ul className="flex flex-col">
                {recent.map((conversation) => (
                  <ConversationRow
                    key={conversation.id}
                    conversation={conversation}
                    onOpen={onOpenConversation}
                  />
                ))}
              </ul>
            )}
          </Section>
        </Card>
        <Card>
          <Section
            title="Recent analyses"
            caption="Chats grounded in a patient, record, lab, or prescription."
            headingAs="h2"
          >
            {analyses.length === 0 ? (
              <p className="text-body-sm text-text-secondary">
                Open the assistant from a patient, record, lab, or prescription to run a grounded
                analysis.
              </p>
            ) : (
              <ul className="flex flex-col">
                {analyses.map((conversation) => (
                  <ConversationRow
                    key={conversation.id}
                    conversation={conversation}
                    onOpen={onOpenConversation}
                  />
                ))}
              </ul>
            )}
          </Section>
        </Card>
      </div>

      {/* Prompt library */}
      {favorites.length > 0 ? (
        <Section title="Favorite prompts" headingAs="h2">
          <PromptCards
            prompts={favorites}
            favoriteIds={favoritePromptIds}
            onUse={onUsePrompt}
            onToggleFavorite={onTogglePromptFavorite}
          />
        </Section>
      ) : null}

      <Section
        title="Suggested prompts"
        caption="One click starts a chat with the prompt pre-filled."
        headingAs="h2"
      >
        <PromptCards
          prompts={prompts}
          favoriteIds={favoritePromptIds}
          onUse={onUsePrompt}
          onToggleFavorite={onTogglePromptFavorite}
        />
      </Section>
    </Stack>
  );
}
