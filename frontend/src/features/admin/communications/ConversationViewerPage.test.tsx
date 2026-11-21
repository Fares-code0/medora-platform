import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { grantForConversation } from './communications';
import type { ContentAccessValue } from './ContentAccessProvider';
import { ConversationViewerPage } from './ConversationViewerPage';

/**
 * The watermarked reader (ADM-06B Task 10 · UX §3.6).
 *
 * `useContentAccess` is mocked rather than driven through the real
 * `ContentAccessProvider` — the provider's own request/release flow is
 * already exercised end to end in `CommunicationsSection.test.tsx`. What
 * this file needs is precise control over the three states a live grant can
 * be in (absent, expired, live-with-a-known-ref) without depending on the
 * mutation service's own sequential id counter or on real timers.
 */
vi.mock('@/app/providers', () => ({
  useAuth: () => ({ user: { name: 'Dr. Amelia Chen' } }),
}));

let access: ContentAccessValue;
vi.mock('./ContentAccessProvider', () => ({
  useContentAccess: () => access,
}));

function renderViewer(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/communications/:conversationId" element={<ConversationViewerPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** No grant has ever been requested for anything. */
function renderViewerWithoutGrant(path: string) {
  access = {
    grant: null,
    ref: null,
    request: vi.fn(),
    release: vi.fn(),
    isLiveFor: () => false,
  };
  return renderViewer(path);
}

/** A grant exists but its window closed before this render. */
function renderViewerWithExpiredGrant(path: string) {
  const conversationId = path.split('/').at(-1) ?? '';
  access = {
    grant: grantForConversation(
      conversationId,
      `Conversation ${conversationId}`,
      'quality-audit',
      'Sampling this thread for a scheduled quality review.',
      Date.now() - 20 * 60_000,
    ),
    ref: 'ca-3',
    request: vi.fn(),
    // Mirrors `ContentAccessProvider.isLiveFor`: an elapsed window is dead,
    // same as no grant at all.
    isLiveFor: () => false,
    release: vi.fn(),
  };
  return renderViewer(path);
}

/** A grant live for exactly this conversation, carrying the given ref. */
function renderViewerWithLiveGrant(path: string, ref: string) {
  const conversationId = path.split('/').at(-1) ?? '';
  access = {
    grant: grantForConversation(
      conversationId,
      `Conversation ${conversationId}`,
      'quality-audit',
      'Sampling this thread for a scheduled quality review.',
      Date.now(),
    ),
    ref,
    request: vi.fn(),
    release: vi.fn(),
    isLiveFor: (id) => id === conversationId,
  };
  return renderViewer(path);
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('the viewer route', () => {
  it('denies and renders no thread when no grant is live', async () => {
    // The defence that exists only because this is a route: a URL someone can
    // type, bookmark, mail, or return to after the grant lapsed.
    renderViewerWithoutGrant('/admin/communications/cv-referral');

    expect(await screen.findByRole('alert')).toHaveTextContent(/no active content access/i);
    expect(screen.queryByTestId('conversation-thread')).toBeNull();
  });

  it('renders nothing at all when the grant has expired', () => {
    renderViewerWithExpiredGrant('/admin/communications/cv-referral');

    expect(screen.queryByTestId('conversation-thread')).toBeNull();
    // Not a shell, not a header, not a watermark over an empty surface.
    expect(screen.queryByTestId('watermark')).toBeNull();
  });

  it('shows the banner reference when a grant is live', async () => {
    renderViewerWithLiveGrant('/admin/communications/cv-referral', 'ca-7');

    expect(await screen.findByRole('status')).toHaveTextContent(/ca-7/);
    expect(screen.getByTestId('conversation-thread')).toBeInTheDocument();
  });

  it('offers no way to write into the conversation', async () => {
    renderViewerWithLiveGrant('/admin/communications/cv-referral', 'ca-7');
    await screen.findByTestId('conversation-thread');

    // Read-only is a property of what is rendered, not of an intention.
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /send|reply|archive|star/i })).toBeNull();
  });
});
