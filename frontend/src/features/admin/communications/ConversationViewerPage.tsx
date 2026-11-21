import { useEffect, useRef } from 'react';

import { ArrowLeft } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';

import { useAuth } from '@/app/providers';
import { Alert } from '@/components/feedback';
import { PageContainer, PageSections } from '@/components/layout';
import { Button } from '@/components/ui';
import { ME_ID, readStoredConversations, SEED_CONTACTS } from '@/features/shared-domain/conversations';
import { routes } from '@/routes';
import { formatDate, formatTime } from '@/utils/dates';

import { useContentAccess } from './ContentAccessProvider';
import { WatermarkOverlay } from './WatermarkOverlay';

/**
 * The watermarked reader — the only screen in Communication Monitoring that
 * shows message content, and only behind a live grant (ADM-06B Task 10 ·
 * UX §3.6).
 *
 * **This route renders nothing at all without a live grant** — not a shell,
 * not a header, not a watermark over an empty surface. That is the defence
 * a route gets that a drawer never could: a URL can be typed, bookmarked,
 * mailed, or returned to long after the grant that opened it has lapsed,
 * none of which is true of state held in a component that only mounts from
 * a click. So the guard is the first thing this component does after its
 * hooks — before the conversation is looked up, before anything is
 * computed — and it is checked on every render, not just the first: an
 * admin who leaves this tab open past the grant's window is re-evaluated by
 * `isLiveFor` exactly like a fresh visit would be.
 *
 * **This feature never writes a message.** There is no composer, no reply,
 * no star, no archive — read-only is a property of what this component
 * renders, not of an intention documented somewhere else. It borrows the
 * shared `Conversation`/`ChatMessage` model from `shared-domain/conversations`
 * rather than the doctor's own message components, which the admin zone is
 * not allowed to import from.
 */
function ConversationViewerPageContent() {
  const { conversationId } = useParams();
  const { ref, isLiveFor, release } = useContentAccess();
  const { user } = useAuth();
  const navigate = useNavigate();

  // `release` is a fresh function every time the provider's grant/ref
  // state changes — including the moment the expiry timer fires its own
  // `release('incomplete')`. A cleanup registered with `[release]` as a
  // dependency would re-fire on every one of those changes, not only on
  // true unmount. This ref always holds the latest `release` without ever
  // re-arming the effect below, so the unmount cleanup calls the CURRENT
  // release — never a stale one closed over a `ref` value that has since
  // been closed out from under it.
  const releaseRef = useRef(release);
  useEffect(() => {
    releaseRef.current = release;
  });

  // StrictMode (on in dev, see main.tsx) mounts this component, unmounts
  // it, then immediately remounts it — same fiber, same hooks state, all
  // synchronously in one tick — purely to catch effects that don't clean
  // up correctly. It is NOT a full destroy/recreate: `useRef` values
  // survive it (that's exactly how `mountedForIdRef` in useChatSession.ts
  // guards the analogous case). A naive `() => releaseRef.current
  // ('completed')` cleanup can't tell that phantom unmount apart from a
  // real departure, so it releases the grant the moment the real mount's
  // effect is still about to run — which is the bug: the entry gets
  // opened and closed in the same tick, and the mounted page is left with
  // no live grant at all.
  //
  // The fix defers the release by one macrotask (`setTimeout(…, 0)`)
  // instead of firing it synchronously in the cleanup, and remembers the
  // pending timer in a ref that (per the paragraph above) survives the
  // remount. StrictMode's remount effect runs BEFORE that macrotask can
  // fire — it's still the same tick — so it finds the pending timer and
  // cancels it: nothing is ever released for the phantom cycle. A real
  // departure has no remount effect to do that cancelling, so the timer
  // fires and `release('completed')` runs as before, just one tick later.
  //
  // This is why it isn't `[release]` in the dependency array either: see
  // the comment on `releaseRef` above — this effect must not re-arm on
  // every grant change, only run its setup/cleanup once per true
  // mount/unmount pair.
  const pendingReleaseTimeoutRef = useRef<number | null>(null);
  useEffect(() => {
    if (pendingReleaseTimeoutRef.current !== null) {
      window.clearTimeout(pendingReleaseTimeoutRef.current);
      pendingReleaseTimeoutRef.current = null;
    }
    return () => {
      pendingReleaseTimeoutRef.current = window.setTimeout(() => {
        pendingReleaseTimeoutRef.current = null;
        releaseRef.current('completed');
      }, 0);
    };
  }, []);

  // The defence that exists only because this is a route. No thread, no
  // watermark, no header — nothing computed past this line without a grant
  // live for exactly this conversation.
  if (conversationId === undefined || !isLiveFor(conversationId)) {
    /*
     * The gate keeps its own header row rather than returning a bare Alert.
     * Two things were wrong with the bare version: the page had no `h1` at
     * all — an `Alert`'s title is a paragraph, correctly, because an alert is
     * a banner and not a section — and it was a dead end. An administrator
     * who followed a stale link was told they could not read the conversation
     * and given nothing to press, which is D-27's defect in a different place:
     * the way out has to be on the screen that blocks you.
     */
    return (
      <PageSections>
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            leadingIcon={ArrowLeft}
            onClick={() => void navigate(routes.admin.communications)}
          >
            Back to communications
          </Button>
          <h1 className="text-h5 font-semibold text-text-primary">Conversation</h1>
        </div>

        <Alert variant="warning" title="No active content access">
          Reading this conversation's content requires a live, justified access grant. Request
          access from Conversation logs to open it.
        </Alert>
      </PageSections>
    );
  }

  const conversation = readStoredConversations().find((entry) => entry.id === conversationId);
  const meLabel = user?.name ?? 'Administrator';
  const contactsById = new Map(SEED_CONTACTS.map((contact) => [contact.id, contact] as const));
  const authorLabel = (authorId: string): string =>
    authorId === ME_ID ? meLabel : (contactsById.get(authorId)?.name ?? authorId);

  const now = new Date().toISOString();
  const watermarkAt = `${formatDate(now)} ${formatTime(now)}`;

  return (
    <PageSections>
      <div className="flex items-center gap-3">
        <Button
          variant="secondary"
          size="sm"
          leadingIcon={ArrowLeft}
          onClick={() => void navigate(routes.admin.communications)}
        >
          Back to communications
        </Button>
        <h1 className="text-h5 font-semibold text-text-primary">
          Conversation {conversationId}
        </h1>
      </div>

      <Alert
        variant="info"
        title={`You are viewing private communication — access logged (ref ${ref ?? '—'})`}
        className="sticky top-0 z-10"
      />

      {conversation === undefined ? (
        <Alert variant="error" title="Conversation not found">
          This conversation no longer exists in the shared message store.
        </Alert>
      ) : (
        <div className="relative">
          <WatermarkOverlay name={meLabel} at={watermarkAt} />
          <div
            data-testid="conversation-thread"
            className="relative flex flex-col gap-4 rounded-surface border border-border bg-surface p-4"
          >
            {conversation.messages.map((message) => (
              <div key={message.id} className="flex flex-col gap-1">
                <div className="flex items-baseline gap-2 text-body-sm">
                  <span className="font-semibold text-text-primary">
                    {authorLabel(message.authorId)}
                  </span>
                  <span className="text-caption text-text-tertiary">
                    {formatDate(message.sentAt)} · {formatTime(message.sentAt)}
                  </span>
                </div>
                <p className="whitespace-pre-wrap text-body-sm text-text-secondary">
                  {message.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </PageSections>
  );
}

/**
 * The page frame the admin area's SectionShell gives every other screen.
 * This page draws its own identity header instead of a SECTION_META one, so
 * it never picked up the container and rendered flush to the viewport edges
 * with no max width. Wrapping the whole component rather than each `return`
 * frames the loading, error and not-found branches too.
 */
export function ConversationViewerPage() {
  return (
    <PageContainer width="2xl">
      <ConversationViewerPageContent />
    </PageContainer>
  );
}
