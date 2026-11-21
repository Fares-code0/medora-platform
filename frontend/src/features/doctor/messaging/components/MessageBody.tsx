import { Fragment, memo, type ReactNode } from 'react';

/**
 * Markdown-lite message renderer — ``` code fences, `inline code`,
 * **bold**, and bare links, matching what the mock threads use.
 * Dependency-free by design (same constraint as the AI feature's
 * renderer); anything unrecognized renders as plain text.
 */

const INLINE_PATTERN = /(\*\*[^*]+\*\*|`[^`]+`|https?:\/\/[^\s)]+)/g;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  return text.split(INLINE_PATTERN).map((part, index) => {
    const key = `${keyPrefix}-${String(index)}`;
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={key} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code key={key} className="rounded-control bg-surface-sunken px-1 font-mono text-[0.92em]">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith('http://') || part.startsWith('https://')) {
      return (
        <a
          key={key}
          href={part}
          target="_blank"
          rel="noreferrer"
          className="break-all text-primary underline underline-offset-2 hover:opacity-80"
        >
          {part}
        </a>
      );
    }
    return <Fragment key={key}>{part}</Fragment>;
  });
}

export const MessageBody = memo(function MessageBody({ body }: { body: string }) {
  const segments = body.split(/```/);
  return (
    <div className="flex flex-col gap-2">
      {segments.map((segment, index) => {
        const key = `seg-${String(index)}`;
        if (segment === '') return null;
        // Odd segments sit between fences → code block.
        if (index % 2 === 1) {
          return (
            <pre
              key={key}
              className="overflow-x-auto rounded-surface border border-border bg-surface-sunken p-2.5 font-mono text-caption leading-4 text-text-primary"
            >
              {segment.replace(/^\n/, '').replace(/\n$/, '')}
            </pre>
          );
        }
        const paragraphs = segment.split('\n').filter((line) => line.trim() !== '');
        return paragraphs.map((line, lineIndex) => (
          <p key={`${key}-${String(lineIndex)}`} className="whitespace-pre-wrap break-words">
            {renderInline(line, `${key}-${String(lineIndex)}`)}
          </p>
        ));
      })}
    </div>
  );
});
