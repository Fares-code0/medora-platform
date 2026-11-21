import { useMemo, useState } from 'react';

import { Copy, Download, FolderOpen, Save, Trash2, Upload } from 'lucide-react';

import { Button, IconButton, Input, Tabs, Textarea } from '@/components/ui';

import {
  parseThemeJson,
  toCss,
  toJson,
  toTypeScript,
  type LegacyOriginal,
  type ThemeExport,
} from '../model/export';

export interface ExportPanelProps {
  readonly theme: ThemeExport;
  readonly saved: readonly ThemeExport[];
  /** The shipped palettes — fill the roles an imported theme predates. */
  readonly original?: LegacyOriginal | undefined;
  readonly onCopy: (text: string, what: string) => void;
  readonly onLoad: (theme: ThemeExport) => void;
  readonly onSave: (name: string) => void;
  readonly onDelete: (name: string) => void;
}

const FORMATS = {
  css: { label: 'CSS variables', file: 'medora-theme.css', type: 'text/css', build: toCss },
  ts: { label: 'TypeScript (patient app)', file: 'medora-theme.ts', type: 'text/plain', build: toTypeScript },
  json: { label: 'JSON', file: 'medora-theme.json', type: 'application/json', build: toJson },
} as const;

type Format = keyof typeof FORMATS;

function download(text: string, file: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = file;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Export, import and locally saved experiments.
 *
 * - CSS → paste over `frontend/src/styles/tokens.css`.
 * - TypeScript → paste over `lightColors` / `darkColors` in
 *   `patient-app/src/theme/tokens.ts`.
 * - JSON → load into this playground or the patient app's; it is the one
 *   format both read.
 */
export function ExportPanel({ theme, saved, original, onCopy, onLoad, onSave, onDelete }: ExportPanelProps) {
  const [format, setFormat] = useState<Format>('css');
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState<string | undefined>(undefined);
  /** What the last import migrated from an older catalogue — said, not applied silently. */
  const [importNotes, setImportNotes] = useState<readonly string[]>([]);
  const [saveName, setSaveName] = useState('');

  const spec = FORMATS[format];
  const text = useMemo(() => spec.build(theme), [spec, theme]);

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2" aria-label="Export">
        <h3 className="text-h5 font-semibold text-text-primary">Export — {theme.name}</h3>
        <Tabs
          aria-label="Export format"
          variant="enclosed"
          value={format}
          onValueChange={(value) => setFormat(value as Format)}
          items={(Object.keys(FORMATS) as Format[]).map((key) => ({ value: key, label: FORMATS[key].label }))}
        />
        <pre
          data-testid="theme-export-output"
          className="max-h-72 overflow-auto rounded-control border border-border bg-surface-sunken p-3 font-mono text-caption text-text-primary"
        >
          {text}
        </pre>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="primary" leadingIcon={Copy} onClick={() => onCopy(text, spec.label)}>
            Copy {spec.label}
          </Button>
          <Button size="sm" variant="secondary" leadingIcon={Download} onClick={() => download(text, spec.file, spec.type)}>
            Download {spec.file}
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-2" aria-label="Import">
        <h3 className="text-h5 font-semibold text-text-primary">Import JSON</h3>
        <Textarea
          label="medora-theme@1 JSON"
          rows={3}
          value={importText}
          error={importError}
          spellCheck={false}
          className="font-mono"
          onChange={(event) => {
            setImportText(event.target.value);
            setImportError(undefined);
          }}
        />
        <div>
          <Button
            size="sm"
            variant="secondary"
            leadingIcon={Upload}
            disabled={importText.trim() === ''}
            onClick={() => {
              const result = parseThemeJson(importText, original);
              if (!result.ok) {
                setImportError(result.error);
                setImportNotes([]);
                return;
              }
              onLoad(result.theme);
              setImportNotes(result.notes ?? []);
              setImportText('');
            }}
          >
            Load as Custom Theme
          </Button>
        </div>
        {importNotes.length > 0 ? (
          <ul role="status" aria-label="Import notes" className="list-disc ps-5 text-caption text-text-secondary">
            {importNotes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="flex flex-col gap-2" aria-label="Saved experiments">
        <h3 className="text-h5 font-semibold text-text-primary">Saved experiments</h3>
        <p className="text-caption text-text-tertiary">
          Stored in this browser only, under <code className="font-mono">medora.dev.theme-playground.*</code>. Never
          read by the app and never touches your real theme preference.
        </p>
        <div className="flex items-end gap-2">
          <Input
            label="Name"
            placeholder="e.g. Ocean draft 2"
            value={saveName}
            containerClassName="flex-1"
            onChange={(event) => setSaveName(event.target.value)}
          />
          <Button
            variant="secondary"
            leadingIcon={Save}
            disabled={saveName.trim() === ''}
            onClick={() => {
              onSave(saveName.trim());
              setSaveName('');
            }}
          >
            Save current
          </Button>
        </div>
        {saved.length === 0 ? (
          <p className="text-body-sm text-text-tertiary">Nothing saved yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-control border border-border">
            {saved.map((entry) => (
              <li key={entry.name} className="flex items-center gap-2 px-3 py-2">
                <span
                  aria-hidden="true"
                  className="h-4 w-4 rounded-pill border border-border-strong"
                  style={{ background: entry.light['--color-primary'] }}
                />
                <span className="flex-1 truncate text-body-sm text-text-primary">{entry.name}</span>
                <IconButton icon={FolderOpen} aria-label={`Load ${entry.name}`} size="sm" variant="neutral" onClick={() => onLoad(entry)} />
                <IconButton icon={Trash2} aria-label={`Delete ${entry.name}`} size="sm" variant="neutral" onClick={() => onDelete(entry.name)} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
