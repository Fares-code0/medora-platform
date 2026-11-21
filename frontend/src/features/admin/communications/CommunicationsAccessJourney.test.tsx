import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { PhiAccessProvider } from '../phi';

import { CommunicationsSection } from './CommunicationsSection';
import { ContentAccessProvider } from './ContentAccessProvider';
import { ConversationViewerPage } from './ConversationViewerPage';

/**
 * The journey the bug report's browser verification actually walked (ADM-06B
 * · UX §3.6): table → "Request content access" → dialog → the conversation
 * "opens read-only", all in one mounted tree.
 *
 * **Why this file exists at all.** 687 existing tests missed the bug that
 * shipped in the fix this file pins, because every one of them — including
 * `ConversationViewerPage.test.tsx`, deliberately — mounts the viewer on its
 * own with a hand-made `ContentAccessValue` (see that file's own doc
 * comment). That is the right shape for exercising the viewer's *rendering*
 * states in isolation, and the wrong shape for catching a defect in the
 * *seam* between the dialog and the viewer: a hand-made grant can never be
 * missing the navigation that is supposed to create it. This file mounts
 * both real components under one real `ContentAccessProvider`, the same
 * parent-above-both-children shape `features/admin/routes.tsx` uses (see its
 * own comment on the `communications` route), so a grant created by a real
 * `request()` call has to survive a real navigation to reach the viewer —
 * exactly the property that was missing.
 *
 * **What this file does NOT prove.** The nested `<Routes>` below is
 * re-declared here, not imported from `adminRoutes` — `routes.test.tsx`
 * documents why (`createMemoryRouter` needs a `Request`/`AbortSignal` realm
 * stub to run under jsdom at all, plus a generous timeout for `route.lazy`
 * to resolve; a plain `MemoryRouter`/`Routes` pair sidesteps both). That
 * trade means this test exercises the provider-above-both-children
 * *arrangement* faithfully, but it would NOT catch a future edit that moved
 * `ConversationViewerPage` out from under `ContentAccessProvider` in the
 * real route table, renamed `:conversationId`, or dropped the child route
 * entirely — `routes.test.tsx`'s own structural assertion
 * ("declares the viewer as a child of the communications route, not a
 * sibling") is what still catches that. The two files are complementary,
 * not redundant: that one pins the route *table's shape*; this one pins
 * that a *live grant survives the navigation* between two really-mounted
 * components.
 */

const capabilities = { current: ['communications.viewMetadata', 'communications.viewContent'] };

vi.mock('@/app/providers', () => ({
  useCan: () => (permission: string) => capabilities.current.includes(permission),
  useAuth: () => ({ user: { name: 'Dr. Amelia Chen' } }),
  useToast: () => ({ toast: () => undefined }),
}));

// Same stub as `CommunicationsSection.test.tsx`: `ContentAccessDialog`
// renders through the design system's `Modal`, a native <dialog> jsdom has
// the element for but not the imperative methods on.
beforeAll(() => {
  const proto = window.HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  proto['showModal'] = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  proto['close'] = function close(this: HTMLDialogElement) {
    this.open = false;
  };
});

beforeEach(() => {
  window.localStorage.clear();
  capabilities.current = ['communications.viewMetadata', 'communications.viewContent'];
});

/**
 * Mirrors the nesting `features/admin/routes.tsx` declares for
 * `communications`: one `ContentAccessProvider` above an index route (the
 * table) and a `:conversationId` child (the viewer) — see that file's
 * comment on why the provider sits there rather than inside either child.
 */
function renderJourney() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/admin/communications?tab=logs']}>
        <PhiAccessProvider>
          <ContentAccessProvider>
            <Routes>
              <Route path="/admin/communications" element={<CommunicationsSection />} />
              <Route
                path="/admin/communications/:conversationId"
                element={<ConversationViewerPage />}
              />
            </Routes>
          </ContentAccessProvider>
        </PhiAccessProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('the content-access journey', () => {
  it('opens the conversation read-only after a grant, from the table in one mounted tree', async () => {
    renderJourney();

    const [button] = await screen.findAllByRole('button', {
      name: /request content access/i,
    });
    if (button === undefined) throw new Error('expected a request-access button');
    const label = button.getAttribute('aria-label') ?? '';
    const match = /conversation (cv-\S+)/i.exec(label);
    if (match?.[1] === undefined) throw new Error(`could not read a conversation id off "${label}"`);
    const conversationId = match[1];

    await userEvent.click(button);
    await userEvent.click(screen.getByRole('radio', { name: /quality audit/i }));
    await userEvent.type(
      screen.getByLabelText(/reason/i),
      'Sampling this thread for a scheduled quality review.',
    );
    await userEvent.click(screen.getByRole('button', { name: /open conversation/i }));

    // The regression itself: without the fix, granting access leaves the
    // administrator on the metadata table — no heading, no thread, no
    // banner ever appear, because nothing ever navigates. This is the one
    // assertion the whole file exists to make.
    expect(
      await screen.findByRole('heading', { name: new RegExp(`Conversation ${conversationId}`) }),
    ).toBeInTheDocument();

    // The read-only banner UX §3.6 requires — "access logged", with a ref
    // the access log actually produced, not a placeholder.
    expect(await screen.findByRole('status')).toHaveTextContent(/access logged/i);
    expect(screen.getByRole('status')).not.toHaveTextContent(/ref —/i);

    // The thread itself: content that was never present on the table (the
    // table renders metadata only — participants, timestamps, counts —
    // never a message body).
    const thread = screen.getByTestId('conversation-thread');
    expect(thread).toBeInTheDocument();
    expect(thread.textContent).not.toBe('');

    // The table this journey started from is gone — this is a navigation,
    // not a second surface layered on top of the first.
    expect(screen.queryByRole('button', { name: /request content access/i })).toBeNull();

    // Read-only per the viewer's own contract: no way to write into the
    // conversation from here.
    expect(screen.queryByRole('textbox')).toBeNull();
    // One full justification-dialog round trip (open, choose a category,
    // type a reason, submit) pays the mock service's own latency on top of
    // real keystroke-by-keystroke typing — the same margin
    // `CommunicationsSection.test.tsx`'s own justification-gate tests give
    // themselves, and for the same reason: honest sequential work, not a
    // hang.
  }, 20000);
});
