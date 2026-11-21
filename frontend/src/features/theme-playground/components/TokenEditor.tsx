import { useEffect, useMemo, useState } from 'react';

import { Copy, RotateCcw } from 'lucide-react';

import { Collapsible, IconButton, Input } from '@/components/ui';

import { hexOf, isValidColor, withHexKeepingAlpha } from '../model/color';
import type { ContrastFinding } from '../model/contrast-rules';
import { GROUPS, TOKEN_META, cssVar, type Palette, type TokenMeta, type WebToken } from '../model/tokens';
import type { Mode } from '../model/usePlayground';

export interface TokenEditorProps {
  readonly mode: Mode;
  readonly palette: Palette;
  readonly findings: readonly ContrastFinding[];
  readonly originValue: (token: WebToken) => string;
  readonly onChange: (token: WebToken, value: string) => void;
  readonly onReset: (token: WebToken) => void;
  readonly onCopy: (text: string) => void;
}

/**
 * One row per token: swatch + native colour picker, the exact value as
 * text, copy and reset. The text field accepts anything tokens.css accepts
 * (`#rgb`, `#rrggbb`, `#rrggbbaa`, `rgba()`), and only commits a value that
 * parses — half-typed input stays in the field, flagged, and never reaches
 * the preview. The picker is the browser's own `<input type="color">`: no
 * dependency, and it keeps a translucent token's alpha (see
 * `withHexKeepingAlpha`).
 */
function TokenRow({
  meta,
  mode,
  value,
  origin,
  failing,
  onChange,
  onReset,
  onCopy,
}: {
  meta: TokenMeta;
  mode: Mode;
  value: string;
  origin: string;
  failing: boolean;
  onChange: (value: string) => void;
  onReset: () => void;
  onCopy: (text: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  const valid = isValidColor(draft);
  const changed = value !== origin;
  const pickerValue = hexOf(value) ?? '#000000';
  const id = `token-${mode}-${meta.name}`;

  return (
    <div className="flex items-start gap-3 border-b border-border py-2.5 last:border-b-0">
      <label className="relative mt-0.5 shrink-0 cursor-pointer" htmlFor={`${id}-picker`}>
        <span className="sr-only">{`${meta.label} colour picker`}</span>
        {/* The swatch IS the picker: the native input sits on top of it, transparent. */}
        <span
          aria-hidden="true"
          className="block h-9 w-9 rounded-control border border-border-strong"
          style={{ background: value }}
        />
        <input
          id={`${id}-picker`}
          type="color"
          value={pickerValue}
          onChange={(event) => onChange(withHexKeepingAlpha(value, event.target.value))}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </label>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-body-sm font-semibold text-text-primary">{meta.label}</span>
          <code className="font-mono text-caption text-text-tertiary">{cssVar(meta.name)}</code>
          {changed ? <span className="text-caption font-semibold text-primary">edited</span> : null}
          {failing ? <span className="text-caption font-semibold text-error">contrast</span> : null}
        </div>
        <p className="text-caption text-text-tertiary">
          {meta.usage}
          {meta.patient ? ` · patient: ${meta.patient}` : ' · web only'}
        </p>
        <Input
          aria-label={`${meta.label} value`}
          value={draft}
          spellCheck={false}
          containerClassName="mt-1.5"
          className="font-mono"
          error={valid ? undefined : 'Not a colour — use #rrggbb or rgba(r, g, b, a)'}
          onChange={(event) => {
            const next = event.target.value;
            setDraft(next);
            if (isValidColor(next)) onChange(next.trim());
          }}
          onBlur={() => {
            if (!isValidColor(draft)) setDraft(value);
          }}
        />
      </div>

      <div className="mt-0.5 flex shrink-0 gap-1">
        <IconButton icon={Copy} aria-label={`Copy ${meta.label} value`} size="sm" variant="neutral" onClick={() => onCopy(value)} />
        <IconButton
          icon={RotateCcw}
          aria-label={`Reset ${meta.label} to ${origin}`}
          title={`Reset to ${origin}`}
          size="sm"
          variant="neutral"
          disabled={!changed}
          onClick={onReset}
        />
      </div>
    </div>
  );
}

export function TokenEditor({ mode, palette, findings, originValue, onChange, onReset, onCopy }: TokenEditorProps) {
  const [open, setOpen] = useState<Record<string, boolean>>({ brand: true });
  const failing = useMemo(
    () => new Set(findings.filter((f) => f.severity === 'fail').flatMap((f) => f.tokens)),
    [findings],
  );

  return (
    <div className="flex flex-col gap-2">
      {GROUPS.map((group) => {
        const tokens = TOKEN_META.filter((m) => m.group === group.id);
        const edited = tokens.filter((m) => palette[m.name] !== originValue(m.name)).length;
        return (
          <Collapsible
            key={group.id}
            id={`tokens-${mode}-${group.id}`}
            title={group.label}
            summary={`${String(tokens.length)} tokens${edited ? ` · ${String(edited)} edited` : ''}`}
            open={open[group.id] ?? false}
            onOpenChange={(next) => setOpen((previous) => ({ ...previous, [group.id]: next }))}
            headingAs="h3"
          >
            <div>
              {tokens.map((meta) => (
                <TokenRow
                  key={meta.name}
                  meta={meta}
                  mode={mode}
                  value={palette[meta.name]}
                  origin={originValue(meta.name)}
                  failing={failing.has(meta.name)}
                  onChange={(value) => onChange(meta.name, value)}
                  onReset={() => onReset(meta.name)}
                  onCopy={onCopy}
                />
              ))}
            </div>
          </Collapsible>
        );
      })}
    </div>
  );
}
