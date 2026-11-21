import { TOKEN_SHADOWS } from '../model/presets';
import { previewStyle } from '../model/preview-style';
import type { Palette } from '../model/tokens';
import type { Mode } from '../model/usePlayground';

import { PreviewGallery } from './PreviewGallery';

/**
 * One isolated preview of one mode. The `dark` class is added for parity
 * with how the app marks dark mode, but it changes nothing on its own — the
 * inline variables (see `preview-style.ts`) already define every token, and
 * they win over both `:root` and `.dark`.
 */
export function PreviewPane({ mode, palette }: { mode: Mode; palette: Palette }) {
  return (
    <div
      data-testid={`theme-preview-${mode}`}
      data-preview-mode={mode}
      className={`${mode === 'dark' ? 'dark' : ''} min-w-0 flex-1 rounded-surface border border-border`}
      style={previewStyle(palette, mode, TOKEN_SHADOWS[mode])}
    >
      <div className="flex items-center justify-between border-b border-border bg-surface px-4 py-2">
        <span className="text-body-sm font-semibold text-text-primary">
          {mode === 'dark' ? 'Dark mode' : 'Light mode'}
        </span>
        <span className="text-caption text-text-tertiary">Live preview</span>
      </div>
      <PreviewGallery scope={mode} />
    </div>
  );
}
