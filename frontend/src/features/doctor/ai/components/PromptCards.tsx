import { Star } from 'lucide-react';

import { Grid } from '@/components/layout';
import { Card, IconButton, Tooltip } from '@/components/ui';
import { cn } from '@/utils/cn';

import type { AiPrompt } from '../model/prompts';

/**
 * Suggested-prompt cards — reusable across the AI dashboard and the empty
 * chat state. The card body is a button that sends the prompt; the star
 * toggles it in the locally-persisted favorites list.
 */
export interface PromptCardsProps {
  prompts: readonly AiPrompt[];
  favoriteIds: readonly string[];
  onUse: (prompt: AiPrompt) => void;
  onToggleFavorite: (promptId: string) => void;
  columns?: { base?: 1 | 2 | 3 | 4; md?: 1 | 2 | 3 | 4; lg?: 1 | 2 | 3 | 4 };
}

export function PromptCards({
  prompts,
  favoriteIds,
  onUse,
  onToggleFavorite,
  columns = { base: 1, md: 2, lg: 3 },
}: PromptCardsProps) {
  return (
    <Grid columns={columns} gap={4}>
      {prompts.map((prompt) => {
        const Icon = prompt.icon;
        const favorite = favoriteIds.includes(prompt.id);
        return (
          <Card key={prompt.id} padding="compact" className="relative">
            <div className="absolute end-2 top-2">
              <Tooltip content={favorite ? 'Remove from favorites' : 'Add to favorites'}>
                <IconButton
                  icon={Star}
                  size="sm"
                  aria-label={
                    favorite
                      ? `Remove "${prompt.title}" from favorite prompts`
                      : `Add "${prompt.title}" to favorite prompts`
                  }
                  aria-pressed={favorite}
                  className={cn(favorite && 'text-warning')}
                  onClick={() => onToggleFavorite(prompt.id)}
                />
              </Tooltip>
            </div>
            <button
              type="button"
              onClick={() => onUse(prompt)}
              className="flex w-full flex-col items-start gap-2 rounded-surface pe-8 text-start"
            >
              <span
                aria-hidden="true"
                className="flex h-8 w-8 items-center justify-center rounded-surface border border-accent bg-accent-subtle text-accent"
              >
                <Icon className="h-4 w-4" strokeWidth={1.75} />
              </span>
              <span className="text-body-sm font-semibold text-text-primary">{prompt.title}</span>
              <span className="text-caption text-text-secondary">{prompt.description}</span>
            </button>
          </Card>
        );
      })}
    </Grid>
  );
}
