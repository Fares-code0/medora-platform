import { Stack } from '@/components/layout';
import { Button, Drawer, Select, Switch } from '@/components/ui';

import {
  AI_LANGUAGE_META,
  AI_RESPONSE_LENGTHS,
  AI_RESPONSE_LENGTH_META,
  AI_TEMPERATURES,
  DEFAULT_AI_SETTINGS,
  type AiLanguage,
  type AiResponseLength,
  type AiSettings,
} from '../model/types';

/**
 * Assistant settings drawer — temperature, response length, language,
 * auto-context, and streaming. Values persist locally via useAiSettings;
 * "Reset to defaults" restores DEFAULT_AI_SETTINGS. All mock: the values
 * shape the canned generator (length) and the chat behavior (streaming),
 * and are annotated where they would drive a real model.
 */
export interface AiSettingsDrawerProps {
  open: boolean;
  onClose: () => void;
  settings: AiSettings;
  onChange: <K extends keyof AiSettings>(key: K, value: AiSettings[K]) => void;
}

export function AiSettingsDrawer({ open, onClose, settings, onChange }: AiSettingsDrawerProps) {
  const resetAll = () => {
    (Object.keys(DEFAULT_AI_SETTINGS) as (keyof AiSettings)[]).forEach((key) => {
      onChange(key, DEFAULT_AI_SETTINGS[key]);
    });
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Assistant settings"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={resetAll}>
            Reset to defaults
          </Button>
          <Button onClick={onClose}>Done</Button>
        </>
      }
    >
      <Stack gap={5}>
        <Select
          label="Temperature"
          helperText="Lower = more deterministic; applied to the real model when the API lands."
          options={AI_TEMPERATURES.map((value) => ({
            value: value.toFixed(1),
            label: value.toFixed(1),
          }))}
          value={settings.temperature.toFixed(1)}
          onChange={(value) => onChange('temperature', Number(value))}
        />
        <Select
          label="Response length"
          options={AI_RESPONSE_LENGTHS.map((length) => ({
            value: length,
            label: AI_RESPONSE_LENGTH_META[length].label,
          }))}
          value={settings.responseLength}
          onChange={(value) => onChange('responseLength', value as AiResponseLength)}
        />
        <Select
          label="Language"
          options={(Object.keys(AI_LANGUAGE_META) as AiLanguage[]).map((language) => ({
            value: language,
            label: AI_LANGUAGE_META[language].label,
          }))}
          value={settings.language}
          onChange={(value) => onChange('language', value as AiLanguage)}
        />
        <Switch
          label="Auto-context"
          description="Seed new chats with the page you opened the assistant from."
          checked={settings.autoContext}
          onCheckedChange={(checked) => onChange('autoContext', checked)}
        />
        <Switch
          label="Stream responses"
          description="Reveal answers token-by-token; off shows them at once."
          checked={settings.streaming}
          onCheckedChange={(checked) => onChange('streaming', checked)}
        />
      </Stack>
    </Drawer>
  );
}
