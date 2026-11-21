import { useCallback, useState } from 'react';

import { readSettings, writeSettings } from '../model/store';
import type { AiSettings } from '../model/types';

/**
 * Assistant settings — read once from localStorage, written through on
 * every change (spec: all settings persist locally). Feature-local by
 * design; the global preferences service stays untouched.
 */
export function useAiSettings() {
  const [settings, setSettings] = useState<AiSettings>(readSettings);

  const update = useCallback(<K extends keyof AiSettings>(key: K, value: AiSettings[K]) => {
    setSettings((previous) => {
      const next = { ...previous, [key]: value };
      writeSettings(next);
      return next;
    });
  }, []);

  const toggleFavoritePrompt = useCallback((promptId: string) => {
    setSettings((previous) => {
      const has = previous.favoritePromptIds.includes(promptId);
      const next = {
        ...previous,
        favoritePromptIds: has
          ? previous.favoritePromptIds.filter((id) => id !== promptId)
          : [...previous.favoritePromptIds, promptId],
      };
      writeSettings(next);
      return next;
    });
  }, []);

  return { settings, update, toggleFavoritePrompt } as const;
}
