import { useState, type ReactNode } from 'react';

import { Check, Copy } from 'lucide-react';

import { IconButton, Tooltip } from '@/components/ui';
import { copyText } from '@/utils/clipboard';

/**
 * Minimal markdown renderer — headings, lists, tables, paragraphs, `---`
 * rules, inline bold/italic/code, and fenced code blocks with a copy action
 * and lightweight token highlighting. Dependency-free; token colours come
 * from semantic text classes only.
 *
 * **Why this is the rich-text pipeline (D-29), and why it needs no
 * sanitizer.** UX §2.3 asks for a rich-text editor for clinical notes, and
 * the row assumed that meant an HTML pipeline: a sanitizer to maintain, and
 * the §12.4 audited `dangerouslySetInnerHTML` exception no file in `src/`
 * currently holds. It does not have to mean that. This renderer parses
 * markdown to **React nodes** — every leaf is a string child that React
 * escapes — so a note containing `<script>` renders those characters and
 * cannot execute them. There is no HTML string anywhere in the path, so
 * there is nothing to sanitize and no exception to grant.
 *
 * It was written for the AI assistant's messages and moved here when
 * clinical notes became the second consumer: §8.2.1 forbids copy-pasting a
 * second variant, and a feature may not import another feature (§3.4), so
 * promotion was the only legal option.
 */

/* ── Inline formatting: `code`, **bold**, *italic* ──────────────── */

function renderEmphasis(text: string, keyBase: string): ReactNode[] {
  // **bold** first, then *italic* inside the remainder.
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={`${keyBase}-b${String(i)}`} className="font-semibold text-text-primary">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return part
      .split(/(\*[^*]+\*)/g)
      .map((sub, j) =>
        sub.startsWith('*') && sub.endsWith('*') && sub.length > 2 ? (
          <em key={`${keyBase}-i${String(i)}-${String(j)}`}>{sub.slice(1, -1)}</em>
        ) : (
          <span key={`${keyBase}-t${String(i)}-${String(j)}`}>{sub}</span>
        ),
      );
  });
}

function renderInline(text: string, keyBase: string): ReactNode[] {
  return text.split(/(`[^`]+`)/g).map((part, i) =>
    part.startsWith('`') && part.endsWith('`') && part.length > 2 ? (
      <code
        key={`${keyBase}-c${String(i)}`}
        className="rounded-control bg-surface-sunken px-1 py-0.5 font-mono text-caption text-text-primary"
      >
        {part.slice(1, -1)}
      </code>
    ) : (
      renderEmphasis(part, `${keyBase}-${String(i)}`)
    ),
  );
}

/* ── Code block with copy + token highlighting ──────────────────── */

const CODE_TOKEN =
  /(\/\/.*$|'[^']*'|"[^"]*"|\b\d+(?:\.\d+)?\b|\b(?:const|let|var|function|return|if|else|new|for|while|import|from|export|await|async)\b)/gm;

function highlightLine(line: string, keyBase: string): ReactNode[] {
  return line.split(CODE_TOKEN).map((token, i) => {
    if (token === undefined || token === '') return null;
    const key = `${keyBase}-${String(i)}`;
    if (token.startsWith('//')) {
      return (
        <span key={key} className="text-text-tertiary">
          {token}
        </span>
      );
    }
    if (/^['"]/.test(token)) {
      return (
        <span key={key} className="text-success">
          {token}
        </span>
      );
    }
    if (/^\d/.test(token)) {
      return (
        <span key={key} className="text-info">
          {token}
        </span>
      );
    }
    if (
      /^(?:const|let|var|function|return|if|else|new|for|while|import|from|export|await|async)$/.test(
        token,
      )
    ) {
      return (
        <span key={key} className="font-medium text-accent">
          {token}
        </span>
      );
    }
    return <span key={key}>{token}</span>;
  });
}

function CodeBlock({ code, language }: { code: string; language: string | null }) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copied = copyState === 'copied';

  const copy = () => {
    const settle = (state: 'copied' | 'failed') => {
      setCopyState(state);
      window.setTimeout(() => setCopyState('idle'), 1_500);
    };
    void copyText(code).then(
      () => settle('copied'),
      () => settle('failed'),
    );
  };

  return (
    <div className="overflow-hidden rounded-surface border border-border bg-surface-sunken">
      <div className="flex items-center justify-between border-b border-border px-3 py-1">
        <span className="font-mono text-caption text-text-tertiary">{language ?? 'code'}</span>
        <Tooltip
          content={copied ? 'Copied' : copyState === 'failed' ? "Couldn't copy" : 'Copy code'}
        >
          <IconButton
            icon={copied ? Check : Copy}
            size="sm"
            aria-label={
              copied
                ? 'Code copied'
                : copyState === 'failed'
                  ? "Couldn't copy the code — select it instead"
                  : 'Copy code to clipboard'
            }
            onClick={copy}
          />
        </Tooltip>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-caption leading-relaxed text-text-primary">
        {code.split('\n').map((line, i) => (
          <div key={i}>{highlightLine(line, `l${String(i)}`)}</div>
        ))}
      </pre>
    </div>
  );
}

/* ── Block-level parsing ────────────────────────────────────────── */

type Block =
  | { kind: 'heading'; level: 2 | 3; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'table'; header: string[]; rows: string[][] }
  | { kind: 'code'; code: string; language: string | null }
  | { kind: 'rule' };

function splitRow(line: string): string[] {
  return line
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function parseBlocks(markdown: string): Block[] {
  const lines = markdown.split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';

    if (line.trim() === '') {
      i += 1;
      continue;
    }
    if (line.startsWith('```')) {
      const language = line.slice(3).trim() || null;
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] ?? '').startsWith('```')) {
        code.push(lines[i] ?? '');
        i += 1;
      }
      i += 1; // closing fence
      blocks.push({ kind: 'code', code: code.join('\n'), language });
      continue;
    }
    if (/^---+\s*$/.test(line)) {
      blocks.push({ kind: 'rule' });
      i += 1;
      continue;
    }
    if (line.startsWith('### ')) {
      blocks.push({ kind: 'heading', level: 3, text: line.slice(4) });
      i += 1;
      continue;
    }
    if (line.startsWith('## ')) {
      blocks.push({ kind: 'heading', level: 2, text: line.slice(3) });
      i += 1;
      continue;
    }
    if (line.startsWith('|')) {
      const table: string[] = [];
      while (i < lines.length && (lines[i] ?? '').startsWith('|')) {
        table.push(lines[i] ?? '');
        i += 1;
      }
      const header = splitRow(table[0] ?? '');
      const rows = table
        .slice(1)
        .filter((row) => !/^\|[\s\-|]+\|?$/.test(row))
        .map(splitRow);
      blocks.push({ kind: 'table', header, rows });
      continue;
    }
    if (line.startsWith('- ') || /^\d+\.\s/.test(line)) {
      const ordered = !line.startsWith('- ');
      const items: string[] = [];
      while (
        i < lines.length &&
        ((lines[i] ?? '').startsWith('- ') || /^\d+\.\s/.test(lines[i] ?? ''))
      ) {
        items.push((lines[i] ?? '').replace(/^(- |\d+\.\s)/, ''));
        i += 1;
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }
    // Paragraph: gather until a blank line or a structural line.
    const paragraph: string[] = [line];
    i += 1;
    while (
      i < lines.length &&
      (lines[i] ?? '').trim() !== '' &&
      !/^(```|## |### |\||- |\d+\.\s|---)/.test(lines[i] ?? '')
    ) {
      paragraph.push(lines[i] ?? '');
      i += 1;
    }
    blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
  }

  return blocks;
}

/* ── Renderer ───────────────────────────────────────────────────── */

export function MarkdownContent({ markdown }: { markdown: string }) {
  const blocks = parseBlocks(markdown);

  return (
    <div className="flex min-w-0 flex-col gap-3 text-body-sm text-text-secondary">
      {blocks.map((block, index) => {
        const key = `blk-${String(index)}`;
        switch (block.kind) {
          case 'heading':
            return block.level === 2 ? (
              <p key={key} className="text-body font-semibold text-text-primary">
                {renderInline(block.text, key)}
              </p>
            ) : (
              <p key={key} className="text-body-sm font-semibold text-text-primary">
                {renderInline(block.text, key)}
              </p>
            );
          case 'paragraph':
            return <p key={key}>{renderInline(block.text, key)}</p>;
          case 'list':
            return block.ordered ? (
              <ol key={key} className="flex list-decimal flex-col gap-1.5 ps-5">
                {block.items.map((item, j) => (
                  <li key={j}>{renderInline(item, `${key}-${String(j)}`)}</li>
                ))}
              </ol>
            ) : (
              <ul key={key} className="flex list-disc flex-col gap-1.5 ps-5">
                {block.items.map((item, j) => (
                  <li key={j}>{renderInline(item, `${key}-${String(j)}`)}</li>
                ))}
              </ul>
            );
          case 'table':
            return (
              <div key={key} className="overflow-x-auto">
                <table className="w-full border-collapse text-body-sm">
                  <thead>
                    <tr className="border-b border-border text-start text-caption font-semibold uppercase tracking-wider text-text-tertiary">
                      {block.header.map((cell, j) => (
                        <th key={j} scope="col" className="py-1.5 pe-4">
                          {renderInline(cell, `${key}-h${String(j)}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, r) => (
                      <tr key={r} className="border-b border-border last:border-b-0">
                        {row.map((cell, c) => (
                          <td key={c} className="py-1.5 pe-4 align-top">
                            {renderInline(cell, `${key}-${String(r)}-${String(c)}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case 'code':
            return <CodeBlock key={key} code={block.code} language={block.language} />;
          case 'rule':
            return <hr key={key} className="border-border" />;
          default:
            return null;
        }
      })}
    </div>
  );
}
