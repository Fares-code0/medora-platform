import { useId, useState } from 'react';

import { Bold, Eye, Italic, List, Pencil } from 'lucide-react';

import { Button, Textarea } from '@/components/ui';
import { useT, useTx } from '@/i18n';

import { MarkdownContent } from './RichText';

/**
 * The rich-text editor for clinical notes (D-29, UX §2.3).
 *
 * **Markdown with a live preview, not WYSIWYG, and that is the point.** The
 * checklist row assumed rich text meant an HTML pipeline — a sanitizer to
 * keep patched and the §12.4 audited `dangerouslySetInnerHTML` exception no
 * file in `src/` holds. Authoring markdown and rendering it through
 * `MarkdownContent` reaches React nodes instead of an HTML string, so a note
 * containing `<script>` renders those characters as text. No sanitizer, no
 * exception, no dependency, and nothing to keep patched — in a clinical
 * record that is worth more than a toolbar that bolds on click.
 *
 * What it gives up, said plainly: the doctor types `**bold**` rather than
 * pressing Ctrl-B and seeing bold. The toolbar wraps the selection to close
 * most of that gap, and Preview shows exactly what the reader will see.
 */

export interface RichTextFieldProps {
  label: string;
  value: string;
  onChange: (next: string) => void;
  rows?: number;
  required?: boolean;
  placeholder?: string | undefined;
  error?: string | undefined;
  helperText?: string | undefined;
}

type Mode = 'write' | 'preview';

export function RichTextField({
  label,
  value,
  onChange,
  rows = 8,
  required,
  placeholder,
  error,
  helperText: helperTextProp,
}: RichTextFieldProps) {
  const t = useT();
  const tx = useTx();
  const helperText = helperTextProp ?? t('richText.helper');
  const [mode, setMode] = useState<Mode>('write');
  const textareaId = useId();

  /**
   * Wraps the current selection, or inserts the markers and leaves the caret
   * between them when nothing is selected — the behaviour of every editor a
   * doctor has used, so the toolbar is not a surprise.
   */
  const wrap = (before: string, after: string = before) => {
    const el = document.getElementById(textareaId);
    if (!(el instanceof HTMLTextAreaElement)) return;
    const { selectionStart: start, selectionEnd: end } = el;
    const selected = value.slice(start, end);
    onChange(`${value.slice(0, start)}${before}${selected}${after}${value.slice(end)}`);
    // Restore focus and put the caret inside the markers.
    requestAnimationFrame(() => {
      el.focus();
      const caret = start + before.length + selected.length;
      el.setSelectionRange(caret, caret);
    });
  };

  const prefixLine = (marker: string) => {
    const el = document.getElementById(textareaId);
    if (!(el instanceof HTMLTextAreaElement)) return;
    const start = value.lastIndexOf('\n', el.selectionStart - 1) + 1;
    onChange(`${value.slice(0, start)}${marker}${value.slice(start)}`);
    requestAnimationFrame(() => {
      el.focus();
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            leadingIcon={Bold}
            aria-label={t('richText.bold')}
            disabled={mode === 'preview'}
            onClick={() => {
              wrap('**');
            }}
          >
            {t('richText.bold')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            leadingIcon={Italic}
            aria-label={t('richText.italic')}
            disabled={mode === 'preview'}
            onClick={() => {
              wrap('*');
            }}
          >
            {t('richText.italic')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            leadingIcon={List}
            aria-label={t('richText.bulletedList')}
            disabled={mode === 'preview'}
            onClick={() => {
              prefixLine('- ');
            }}
          >
            {t('richText.list')}
          </Button>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          leadingIcon={mode === 'write' ? Eye : Pencil}
          onClick={() => {
            setMode(mode === 'write' ? 'preview' : 'write');
          }}
        >
          {mode === 'write' ? t('richText.preview') : t('richText.write')}
        </Button>
      </div>

      {mode === 'write' ? (
        <Textarea
          id={textareaId}
          label={label}
          required={required}
          rows={rows}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
          }}
          placeholder={placeholder}
          helperText={helperText}
          error={error}
        />
      ) : (
        <div>
          <p className="mb-1 text-caption font-medium text-text-secondary">
            {tx('richText.previewOf', { label })}
          </p>
          <div className="min-h-[8rem] rounded-surface border border-border bg-surface-sunken p-3">
            {value.trim() === '' ? (
              <p className="text-body-sm text-text-secondary">{t('richText.empty')}</p>
            ) : (
              <MarkdownContent markdown={value} />
            )}
          </div>
          {error === undefined ? null : <p className="mt-1 text-caption text-error">{error}</p>}
        </div>
      )}
    </div>
  );
}
