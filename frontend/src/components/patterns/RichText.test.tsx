import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MarkdownContent } from './RichText';

/**
 * The security property D-29 rests on.
 *
 * The row assumed rich text meant an HTML pipeline — a sanitizer to keep
 * patched, and the §12.4 audited `dangerouslySetInnerHTML` exception no file
 * in `src/` holds. This renderer parses markdown to React nodes instead, so
 * every leaf is a string child React escapes. These tests pin that: if
 * anyone ever "optimises" this into an HTML string, they fail.
 */

describe('MarkdownContent is safe by construction', () => {
  it('renders a script tag as text, never as an element', () => {
    const { container } = render(
      <MarkdownContent markdown={'Patient said <script>alert(1)</script> yesterday.'} />,
    );
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('<script>alert(1)</script>');
  });

  it('does not execute an inline event handler in an img tag', () => {
    const { container } = render(
      <MarkdownContent markdown={'<img src=x onerror="alert(1)">'} />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('onerror');
  });

  it('renders raw HTML in a fenced block as literal text', () => {
    const { container } = render(
      <MarkdownContent markdown={'```\n<iframe src="evil"></iframe>\n```'} />,
    );
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.textContent).toContain('<iframe');
  });

  it('still formats the markdown a clinician actually writes', () => {
    const { container, getByText } = render(
      <MarkdownContent markdown={'## Assessment\n\n**Stable** on *review*.\n\n- Continue statin\n- Recheck in 6 weeks'} />,
    );
    // `##`, not `#`: the renderer starts headings at h2 on purpose — the page
    // already owns its h1, and a note that emitted one would break the
    // document outline F-17 fixed.
    expect(getByText('Assessment')).toBeInTheDocument();
    expect(container.querySelector('strong')?.textContent).toBe('Stable');
    expect(container.querySelector('em')?.textContent).toBe('review');
    expect(container.querySelectorAll('li')).toHaveLength(2);
  });

  it('never reaches for dangerouslySetInnerHTML', async () => {
    /*
     * The rule as a rule, not just its symptoms: the module must not use the
     * escape hatch §12.4 bans. Comments are stripped first — this file and
     * that one both *discuss* the API by name, and a test that cannot tell
     * prose from code would fail on its own documentation, which is how a
     * guard gets deleted for being annoying rather than fixed.
     */
    const fs = await import('node:fs');
    const source = fs.readFileSync('src/components/patterns/RichText.tsx', 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    expect(code).not.toContain('dangerouslySetInnerHTML');
    expect(code).not.toContain('innerHTML');
    // Guard the guard: stripping must not have emptied the file.
    expect(code).toContain('export function MarkdownContent');
  });
});
