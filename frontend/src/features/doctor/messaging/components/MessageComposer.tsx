import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

import { SendHorizontal, Smile } from 'lucide-react';

import { Button, IconButton, Tooltip } from '@/components/ui';
import { useOutsideClick } from '@/hooks/useOutsideClick';
import { cn } from '@/utils/cn';

/**
 * Chat composer — floating multi-line input. Enter sends, Shift+Enter
 * inserts a newline, Escape blurs. Drafts autosave on a debounce (the
 * parent persists them); the emoji button opens a small inline picker that
 * appends to the draft. The textarea auto-grows up to ~6 lines.
 */

const MAX_LENGTH = 2000;
const DRAFT_DEBOUNCE_MS = 600;

const EMOJI = ['🙂', '😀', '😂', '👍', '🙏', '❤️', '🎉', '😢', '😮', '🤝', '✅', '⏰'] as const;

export interface MessageComposerProps {
  /** Initial value when switching conversations (stored draft). */
  draft: string;
  sending: boolean;
  onSend: (body: string) => void;
  onDraftChange: (draft: string) => void;
  disabled?: boolean;
}

export function MessageComposer({
  draft,
  sending,
  onSend,
  onDraftChange,
  disabled = false,
}: MessageComposerProps) {
  const [value, setValue] = useState(draft);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const emojiRef = useRef<HTMLDivElement | null>(null);
  const draftTimer = useRef<number | null>(null);

  const emojiRefs = useMemo(() => [emojiRef], []);
  const closeEmoji = useCallback(() => setEmojiOpen(false), []);
  useOutsideClick(emojiRefs, closeEmoji, emojiOpen);

  // Switching conversations swaps the stored draft in.
  useEffect(() => {
    setValue(draft);
  }, [draft]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea === null) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${String(Math.min(textarea.scrollHeight, 132))}px`;
  }, [value]);

  useEffect(
    () => () => {
      if (draftTimer.current !== null) window.clearTimeout(draftTimer.current);
    },
    [],
  );

  const update = (next: string) => {
    setValue(next);
    if (draftTimer.current !== null) window.clearTimeout(draftTimer.current);
    draftTimer.current = window.setTimeout(() => onDraftChange(next), DRAFT_DEBOUNCE_MS);
  };

  const insertEmoji = (emoji: string) => {
    update(value.length + emoji.length <= MAX_LENGTH ? value + emoji : value);
    setEmojiOpen(false);
    textareaRef.current?.focus();
  };

  const send = () => {
    const body = value.trim();
    if (body === '' || sending || disabled) return;
    if (draftTimer.current !== null) window.clearTimeout(draftTimer.current);
    setValue('');
    onSend(body);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    } else if (event.key === 'Escape') {
      event.currentTarget.blur();
    }
  };

  const remaining = MAX_LENGTH - value.length;

  return (
    <div className="border-t border-border bg-surface p-3">
      <div
        className={cn(
          'flex items-end gap-2 rounded-surface border border-border-strong bg-surface p-2',
          'transition-colors duration-base focus-within:border-primary',
        )}
      >
        <div ref={emojiRef} className="relative">
          {emojiOpen ? (
            <div
              role="listbox"
              aria-label="Emoji"
              className={cn(
                'absolute bottom-full start-0 z-dropdown mb-2 grid w-44 grid-cols-6 gap-0.5',
                'rounded-surface border border-border bg-surface-overlay p-1.5 shadow-modal',
              )}
            >
              {EMOJI.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  role="option"
                  aria-selected={false}
                  aria-label={`Insert ${emoji}`}
                  onClick={() => insertEmoji(emoji)}
                  className={cn(
                    'flex h-6 w-6 items-center justify-center rounded-surface text-h4',
                    'transition-colors duration-fast hover:bg-surface-sunken',
                  )}
                >
                  {emoji}
                </button>
              ))}
            </div>
          ) : null}
          <Tooltip content="Emoji">
            <IconButton
              icon={Smile}
              size="sm"
              variant="neutral"
              aria-label="Insert emoji"
              aria-expanded={emojiOpen}
              onClick={() => setEmojiOpen((open) => !open)}
            />
          </Tooltip>
        </div>

        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          maxLength={MAX_LENGTH}
          disabled={disabled}
          placeholder="Write a message… (Enter to send, Shift+Enter for a new line)"
          aria-label="Message"
          onChange={(event) => update(event.target.value)}
          onKeyDown={onKeyDown}
          className={cn(
            'max-h-[132px] min-h-[32px] flex-1 resize-none bg-transparent px-1 py-1.5',
            // The placeholder colour role, for the reason
            // ui/internal/styles.ts records: the disabled one is a 3:1
            // non-text token and a placeholder in an active field is text.
            'text-body text-text-primary placeholder:text-text-placeholder focus:outline-none',
            // 16px on a coarse pointer so iOS Safari does not zoom into the
            // focused composer (as every text field does, ui/internal/styles.ts).
            'touch:text-h3',
            'disabled:cursor-not-allowed disabled:text-text-disabled',
          )}
        />

        <Button
          size="sm"
          leadingIcon={SendHorizontal}
          loading={sending}
          disabled={disabled || value.trim() === ''}
          onClick={send}
          aria-label="Send message"
        >
          Send
        </Button>
      </div>
      <div className="mt-1 flex items-center justify-between px-1">
        <p className="text-caption text-text-secondary">
          Drafts save automatically · type <code className="font-mono">[fail]</code> to preview the
          retry flow
        </p>
        <p
          className={cn(
            'text-caption tabular-nums',
            remaining < 100 ? 'text-warning' : 'text-text-tertiary',
          )}
          aria-live="polite"
        >
          {value.length}/{MAX_LENGTH}
        </p>
      </div>
    </div>
  );
}
