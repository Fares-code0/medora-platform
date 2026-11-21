import { useState, type KeyboardEvent } from 'react';

import { SendHorizonal, Square } from 'lucide-react';

import { Button, Textarea } from '@/components/ui';

import type { ChatPhase } from '../hooks/useChatSession';

/**
 * Message composer — Enter sends, Shift+Enter inserts a newline. While a
 * response is generating the send button becomes Stop (stop-mid-stream
 * is a first-class action, not a disabled state).
 */
export interface ChatComposerProps {
  phase: ChatPhase;
  onSend: (text: string) => void;
  onStop: () => void;
  disabled?: boolean;
}

export function ChatComposer({ phase, onSend, onStop, disabled = false }: ChatComposerProps) {
  const [text, setText] = useState('');
  const generating = phase !== 'idle';

  const submit = () => {
    const trimmed = text.trim();
    if (trimmed === '' || generating || disabled) return;
    onSend(trimmed);
    setText('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className="flex items-end gap-2">
      <div className="min-w-0 flex-1">
        <Textarea
          label="Message the assistant"
          placeholder="Ask a clinical question… (Enter to send, Shift+Enter for a new line)"
          rows={2}
          value={text}
          disabled={disabled}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      {generating ? (
        <Button variant="secondary" leadingIcon={Square} onClick={onStop}>
          Stop
        </Button>
      ) : (
        <Button
          variant="ai"
          leadingIcon={SendHorizonal}
          onClick={submit}
          disabled={disabled || text.trim() === ''}
        >
          Send
        </Button>
      )}
    </div>
  );
}
