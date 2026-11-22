import { useCallback, useState } from 'react';

import { useAuth } from '@/app/providers';

import { readSettings, writeSettings } from '../model/store';
import type { AiSettings } from '../model/types';

/**
 * Assistant settings — read once from the signed-in user's namespace,
 * written through on every change (spec: all settings persist locally).
 * Per user (`medora.<userId>.ai.settings.v1`), so logout's
 * `clearUserPreferences` wipes them and another account never reads them.
 */
export function useAiSettings() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [settings, setSettings] = useState<AiSettings>(() => readSettings(userId));

  const update = useCallback(
    <K extends keyof AiSettings>(key: K, value: AiSettings[K]) => {
      setSettings((previous) => {
        const next = { ...previous, [key]: value };
        writeSettings(next, userId);
        return next;
      });
    },
    [userId],
  );

  const toggleFavoritePrompt = useCallback(
    (promptId: string) => {
      setSettings((previous) => {
        const has = previous.favoritePromptIds.includes(promptId);
        const next = {
          ...previous,
          favoritePromptIds: has
            ? previous.favoritePromptIds.filter((id) => id !== promptId)
            : [...previous.favoritePromptIds, promptId],
        };
        writeSettings(next, userId);
        return next;
      });
    },
    [userId],
  );

  return { settings, update, toggleFavoritePrompt } as const;
}
