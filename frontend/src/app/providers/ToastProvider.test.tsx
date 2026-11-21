import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/i18n';

import { ANNOUNCEMENT_TTL_MS, ANNOUNCER_ATTRIBUTE, announcementText } from './toast-announcer';
import { ToastProvider, useToast, type ToastOptions } from './ToastProvider';

/**
 * F-18 — how toasts are announced.
 *
 * The host used to be one polite `aria-live` stack in which every toast was
 * itself a `role="status"` or `role="alert"` region: a live region nested in
 * another, a known cause of double or missed announcements, and the dismiss
 * button's name sat inside what was read. These pin the replacement: two
 * persistent announcers (polite, assertive) receive the title and
 * description only, one node per toast; the visual stack announces nothing.
 *
 * jsdom has no accessibility tree, so this asserts the ARIA structure a
 * screen reader acts on, not what NVDA or VoiceOver actually say.
 */

afterEach(() => vi.useRealTimers());

function announcer(politeness: 'polite' | 'assertive'): HTMLElement {
  const node = document.querySelector<HTMLElement>(`[${ANNOUNCER_ATTRIBUTE}="${politeness}"]`);
  if (node === null) throw new Error(`no ${politeness} announcer`);
  return node;
}

function spoken(politeness: 'polite' | 'assertive'): string[] {
  return [...announcer(politeness).children].map((child) => child.textContent ?? '');
}

function Trigger({ calls }: { calls: readonly ToastOptions[] }) {
  const { toast } = useToast();
  return (
    <button type="button" onClick={() => calls.forEach((options) => toast(options))}>
      fire
    </button>
  );
}

function renderHost(calls: readonly ToastOptions[]) {
  render(
    <LocaleProvider>
      <ToastProvider>
        <Trigger calls={calls} />
      </ToastProvider>
    </LocaleProvider>,
  );
  return () => screen.getByRole('button', { name: 'fire' });
}

describe('toast announcer', () => {
  it('has both regions from mount, empty, so the first toast is not lost', () => {
    renderHost([]);
    for (const politeness of ['polite', 'assertive'] as const) {
      const region = announcer(politeness);
      expect(region).toHaveAttribute('aria-live', politeness);
      expect(region).toHaveAttribute('aria-relevant', 'additions');
      expect(region).toHaveAttribute('aria-atomic', 'false');
      expect(region).toHaveClass('sr-only');
      expect(region).toBeEmptyDOMElement();
    }
  });

  it.each(['success', 'info', 'warning'] as const)(
    'announces a %s toast politely: title and description, nothing else',
    async (variant) => {
      const fire = renderHost([{ variant, title: 'Note saved', description: 'It is unsigned.' }]);
      await userEvent.click(fire());

      expect(spoken('polite')).toEqual(['Note saved. It is unsigned.']);
      expect(spoken('assertive')).toEqual([]);
    },
  );

  it('announces an error assertively, as the old role="alert" meant', async () => {
    const fire = renderHost([
      { variant: 'error', title: 'Could not save', description: 'Try again.' },
    ]);
    await userEvent.click(fire());

    expect(spoken('assertive')).toEqual(['Could not save. Try again.']);
    expect(spoken('polite')).toEqual([]);
  });

  it('reads two toasts in quick succession both, and a repeated message twice', async () => {
    const fire = renderHost([
      { variant: 'success', title: 'Alert resolved' },
      { variant: 'success', title: 'Contact removed' },
      { variant: 'success', title: 'Contact removed' },
    ]);
    await userEvent.click(fire());

    // Appended, not replaced: each is its own addition to the region.
    expect(spoken('polite')).toEqual(['Alert resolved', 'Contact removed', 'Contact removed']);
  });

  it('nests no live region: the visible toast is neither a region nor inside one', async () => {
    const fire = renderHost([{ variant: 'error', title: 'Could not save' }]);
    await userEvent.click(fire());

    const visible = screen.getByText('Could not save');
    expect(visible.closest('[role="status"], [role="alert"], [aria-live]')).toBeNull();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('never reads the dismiss or action labels', async () => {
    const fire = renderHost([
      {
        variant: 'info',
        title: 'Widget removed',
        action: { label: 'Undo', onClick: () => undefined },
      },
    ]);
    await userEvent.click(fire());

    const text = announcer('polite').textContent ?? '';
    expect(text).toBe('Widget removed');
    expect(text).not.toMatch(/Dismiss|Undo/);
  });

  it('keeps the dismiss control named, tied to its toast, and operable by keyboard; dismissal is silent', async () => {
    const fire = renderHost([{ variant: 'error', title: 'Could not save' }]);
    await userEvent.click(fire());

    const dismiss = screen.getByRole('button', { name: 'Dismiss notification' });
    expect(dismiss).toHaveAccessibleDescription('Could not save');
    dismiss.focus();
    await userEvent.keyboard('{Enter}');

    expect(screen.queryByText('Could not save')).not.toBeInTheDocument();
    // Still the one announcement made when it appeared; closing it adds none.
    expect(spoken('assertive')).toEqual(['Could not save']);
    expect(spoken('polite')).toEqual([]);
  });

  it('removes an announcement once it has expired, without touching the visible error', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fire = renderHost([{ variant: 'error', title: 'Could not save' }]);
    await userEvent.click(fire());
    expect(spoken('assertive')).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(ANNOUNCEMENT_TTL_MS + 1);
    });

    expect(spoken('assertive')).toEqual([]);
    // Errors persist until dismissed (DS §8.23) — only the spoken copy goes.
    expect(screen.getByText('Could not save')).toBeInTheDocument();
  });

  it('leaves no timer behind when it unmounts with a toast still on screen', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { unmount } = render(
      <LocaleProvider>
        <ToastProvider>
          <Trigger calls={[{ variant: 'success', title: 'Saved' }]} />
        </ToastProvider>
      </LocaleProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'fire' }));
    expect(screen.getByText('Saved')).toBeInTheDocument();

    unmount();
    // A dismiss timer that outlives the provider fires into a torn-down page.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('is excluded from text queries, so a test finds the visible toast once', async () => {
    const fire = renderHost([{ variant: 'success', title: 'Time off cancelled' }]);
    await userEvent.click(fire());

    expect(screen.getAllByText('Time off cancelled')).toHaveLength(1);
    expect(spoken('polite')).toEqual(['Time off cancelled']);
  });
});

describe('announcementText', () => {
  it('joins title and description into two sentences', () => {
    expect(announcementText({ title: 'Saved', description: 'It is unsigned.' })).toBe(
      'Saved. It is unsigned.',
    );
  });

  it('does not double terminal punctuation', () => {
    expect(announcementText({ title: 'Saved!', description: 'Done.' })).toBe('Saved! Done.');
  });

  it('reads the title alone when there is no description', () => {
    expect(announcementText({ title: '  Saved  ', description: '   ' })).toBe('Saved');
  });
});
