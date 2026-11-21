import { useMemo, useState } from 'react';

import { Check, Palette as PaletteIcon, RotateCcw, Wand2 } from 'lucide-react';

import { useToast } from '@/app/providers';
import { Alert } from '@/components/feedback';
import { Badge, Button, Card, ConfirmationDialog, Tabs } from '@/components/ui';

import { ContrastPanel } from '../components/ContrastPanel';
import { ExportPanel } from '../components/ExportPanel';
import { PreviewPane } from '../components/PreviewPane';
import { TokenEditor } from '../components/TokenEditor';
import { copyFeedback, copyText } from '../model/clipboard';
import { checkPalette } from '../model/contrast-rules';
import type { ThemeExport } from '../model/export';
import type { Palette, WebToken } from '../model/tokens';
import { usePlayground, type ActiveId, type Mode } from '../model/usePlayground';

/**
 * Theme Playground — a DEVELOPMENT-ONLY design-system editor.
 *
 * The route is registered only on the local dev server with
 * `VITE_APP_ENV=development` (`import.meta.env.MEDORA_THEME_PLAYGROUND`, see
 * `app/router/index.tsx`). Every `vite build` — production AND the public
 * demo's `build:demo`, where `import.meta.env.DEV` is true — compiles the flag
 * to `false`, drops the route and this code, and is failed by
 * `scripts/theme-playground-boundary.ts` if any of it survives.
 *
 * What it can and cannot touch:
 * - It renders its preview inside an isolated variable scope
 *   (`model/preview-style.ts`). The rest of the app — this page's own chrome
 *   included — keeps your real theme.
 * - It never writes `medora.theme` or any real preference. Experiments live
 *   under `medora.dev.theme-playground.*` (`model/storage.ts`).
 * - It cannot change Medora. Making a palette real is a manual step: copy the
 *   CSS export into `src/styles/tokens.css`, and the TypeScript export into
 *   `patient-app/src/theme/tokens.ts`. See docs/THEME_CUSTOMIZATION.md.
 */

type View = Mode | 'both';

function Swatches({ palette }: { palette: Palette }) {
  const keys: readonly WebToken[] = ['--color-primary', '--color-accent', '--color-surface', '--color-background', '--color-text-primary'];
  return (
    <span className="flex overflow-hidden rounded-control border border-border">
      {keys.map((key) => (
        <span key={key} aria-hidden="true" className="h-5 w-5" style={{ background: palette[key] }} />
      ))}
    </span>
  );
}

function PresetCard({
  label,
  description,
  theme,
  selected,
  onSelect,
}: {
  label: string;
  description: string;
  theme: ThemeExport | null;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={`flex min-w-0 flex-col gap-2 rounded-surface border p-3 text-start transition-colors duration-base ${
        selected ? 'border-primary bg-primary-subtle' : 'border-border bg-surface hover:bg-surface-sunken'
      }`}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="truncate text-body-sm font-semibold text-text-primary">{label}</span>
        {selected ? <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-primary" /> : null}
      </span>
      {theme ? (
        <span className="flex gap-1.5">
          <Swatches palette={theme.light} />
          <Swatches palette={theme.dark} />
        </span>
      ) : (
        <span className="text-caption text-text-tertiary">Starts from the current palette</span>
      )}
      <span className="line-clamp-2 text-caption text-text-tertiary">{description}</span>
    </button>
  );
}

export function ThemePlaygroundPage() {
  const playground = usePlayground();
  const { toast } = useToast();
  const [editMode, setEditMode] = useState<Mode>('light');
  const [view, setView] = useState<View>('both');
  /** A destructive step waiting for confirmation. */
  const [pending, setPending] = useState<{
    readonly title: string;
    readonly confirmLabel: string;
    readonly run: () => void;
  } | null>(null);

  const palette = playground.theme[editMode];
  const findings = useMemo(() => checkPalette(palette), [palette]);
  const otherMode: Mode = editMode === 'light' ? 'dark' : 'light';
  const otherFails = useMemo(
    () => checkPalette(playground.theme[otherMode]).filter((f) => f.severity === 'fail').length,
    [playground.theme, otherMode],
  );

  const guard = (run: () => void, replacesCustom: boolean) => {
    if (replacesCustom) setPending({ title: 'Replace your Custom Theme?', confirmLabel: 'Replace', run });
    else run();
  };

  const setToken = (token: WebToken, value: string) =>
    guard(() => playground.setToken(editMode, token, value), playground.wouldReplaceCustom);

  const loadTheme = (theme: ThemeExport) => guard(() => playground.loadTheme(theme), playground.custom !== null);

  const copy = (text: string, what = 'Value') => {
    // Every outcome is reported, and only a real copy as success (model/clipboard.ts).
    void copyText(text).then((outcome) => toast(copyFeedback(outcome, what)));
  };

  const cards: readonly { id: ActiveId; label: string; description: string; theme: ThemeExport | null }[] = [
    ...playground.presets.map((preset) => ({
      id: preset.id,
      label: preset.label,
      description: preset.description,
      theme: { name: preset.label, light: preset.light, dark: preset.dark },
    })),
    {
      id: 'custom',
      label: playground.custom ? playground.custom.custom.name : 'Custom Theme',
      description: playground.custom
        ? `Edited from ${playground.custom.origin.name}. Reset returns there.`
        : 'Your own palette. Any edit to a preset starts one.',
      theme: playground.custom?.custom ?? null,
    },
  ];

  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-container-2xl flex-wrap items-center gap-3 px-4 py-4 sm:px-6">
          <PaletteIcon aria-hidden="true" className="h-6 w-6 text-primary" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-h2 font-semibold text-text-primary">Theme Playground</h1>
              <Badge variant="warning" emphasis="outline">
                Development only
              </Badge>
            </div>
            <p className="text-body-sm text-text-secondary">
              Experiment freely — nothing here changes Medora or your saved theme. Apply a result by pasting the export
              into <code className="font-mono">src/styles/tokens.css</code>.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={RotateCcw}
              disabled={playground.active !== 'custom'}
              onClick={() => playground.resetMode(editMode)}
            >
              Reset {editMode} palette
            </Button>
            <Button
              variant="destructive-secondary"
              size="sm"
              leadingIcon={RotateCcw}
              disabled={playground.custom === null}
              onClick={() => setPending({ title: 'Reset all changes?', confirmLabel: 'Reset all', run: playground.resetAll })}
            >
              Reset all changes
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-container-2xl flex-col gap-5 px-4 py-5 sm:px-6">
        {playground.storageNotes.length > 0 ? (
          <Alert
            variant="info"
            title="Stored experiments were updated to the current token catalogue"
            onDismiss={playground.dismissStorageNotes}
          >
            <ul className="list-disc ps-5">
              {playground.storageNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </Alert>
        ) : null}
        <section aria-label="Theme presets" className="grid gap-3 sm:grid-cols-3 xl:grid-cols-5">
          {cards.map((card) => (
            <PresetCard
              key={card.id}
              label={card.label}
              description={card.description}
              theme={card.theme}
              selected={playground.active === card.id}
              onSelect={() => playground.selectPreset(card.id)}
            />
          ))}
        </section>

        <div className="grid gap-5 xl:grid-cols-[minmax(380px,460px)_1fr]">
          <div className="flex min-w-0 flex-col gap-4">
            <Card padding="compact">
              <div className="flex flex-col gap-3">
                <Tabs
                  aria-label="Palette being edited"
                  variant="enclosed"
                  value={editMode}
                  onValueChange={(value) => setEditMode(value as Mode)}
                  items={[
                    { value: 'light', label: 'Edit Light' },
                    { value: 'dark', label: 'Edit Dark' },
                  ]}
                />
                {playground.active !== 'custom' ? (
                  <p className="flex items-center gap-1.5 text-caption text-text-tertiary">
                    <Wand2 aria-hidden="true" className="h-3.5 w-3.5" />
                    Presets are read-only: your first edit copies this one into a Custom Theme.
                  </p>
                ) : null}
                <ContrastPanel mode={editMode} findings={findings} onApply={setToken} />
                {otherFails > 0 ? (
                  <p className="text-caption text-error">
                    {`The ${otherMode} palette has ${String(otherFails)} contrast failure${otherFails === 1 ? '' : 's'} — switch to Edit ${otherMode === 'light' ? 'Light' : 'Dark'} to see them.`}
                  </p>
                ) : null}
              </div>
            </Card>
            <Card padding="compact">
              <TokenEditor
                mode={editMode}
                palette={palette}
                findings={findings}
                originValue={(token) => playground.originValue(editMode, token)}
                onChange={setToken}
                onReset={(token) => playground.resetToken(editMode, token)}
                onCopy={(text) => copy(text)}
              />
            </Card>
          </div>

          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-h4 font-semibold text-text-primary">Live preview</h2>
              <Tabs
                aria-label="Preview mode"
                variant="enclosed"
                value={view}
                onValueChange={(value) => setView(value as View)}
                items={[
                  { value: 'light', label: 'Light' },
                  { value: 'dark', label: 'Dark' },
                  { value: 'both', label: 'Side by side' },
                ]}
              />
            </div>
            <div className="flex flex-col gap-3 2xl:flex-row">
              {view !== 'dark' ? <PreviewPane mode="light" palette={playground.theme.light} /> : null}
              {view !== 'light' ? <PreviewPane mode="dark" palette={playground.theme.dark} /> : null}
            </div>
          </div>
        </div>

        <Card title="Export, import & saved experiments">
          <ExportPanel
            theme={playground.theme}
            saved={playground.saved}
            original={playground.presets[0]}
            onCopy={copy}
            onLoad={loadTheme}
            onSave={playground.saveCurrent}
            onDelete={playground.deleteSaved}
          />
        </Card>
      </main>

      <ConfirmationDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        onConfirm={() => {
          pending?.run();
          setPending(null);
        }}
        title={pending?.title ?? ''}
        description="This discards your Custom Theme edits. Save them under Saved experiments first if you want to keep them."
        confirmLabel={pending?.confirmLabel ?? 'Confirm'}
        tone="destructive"
      />
    </div>
  );
}
