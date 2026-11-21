# Phase 14 — Doctor Messaging & Communication Center

## Overview

`/doctor/messages` is now a full communication workspace — a
three-pane, full-height surface (folder rail · conversation list ·
chat) in the spirit of Teams/Slack and EMR inboxes, not another
header-cards-table page. It is a self-contained feature module wired
into the existing router, guards, shell badges, TanStack Query setup,
and design system, with a localStorage-persisted mock data layer built
from the canonical 5-entity dataset.

## Architecture

```
src/features/doctor/messaging/
  index.ts                     public API: routes + badge query
  routes.tsx                   lazy /doctor/messages(/:conversationId)
  model/
    types.ts                   Contact/Conversation/ChatMessage/folders
    mock-data.ts               5 contacts · 5 seeded conversations
    store.ts                   localStorage boundary (medora.messaging.v1)
    selectors.ts               folders, search, counts, shared assets
  mock/mock-messaging-service.ts  Promise seams (latency, [fail] retry,
                                  canned counterpart reply)
  api/useMessagingQueries.ts   queries + mutations; badge query is public
  components/
    FolderRail.tsx             folders w/ counts, favorites, contacts
    ConversationListPane.tsx   search + rich previews + arrow-key nav
    ChatWorkspace.tsx          header actions, timeline, typing, composer
    MessageBubble.tsx          memoized bubble w/ states + hover actions
    MessageBody.tsx            markdown-lite (code fences, bold, links)
    MessageComposer.tsx        multi-line composer w/ draft autosave
    ConversationDetailsDrawer.tsx  participants, shared assets, settings
    NewMessageDialog.tsx       contact picker → open/create direct thread
  pages/MessagesPage.tsx       URL-owned folder/search, responsive panes
```

- The route replaces the `/doctor/messages` placeholder; the open
  thread is the `:conversationId` path param, folder/search live in
  query params (deep-linkable, like every other module).
- `ShellBadgesProvider` (app layer) now sources the sidebar/tab-bar
  `messages` badge from this feature's polled badge query; the
  notifications feature is untouched.

## Features

Inbox / Unread / Starred / Sent / Drafts / Archived folders with live
counts · conversation + message search (with per-thread match counts) ·
new conversation via contact picker (reuses an existing direct thread) ·
reply · forward (mock toast) · delete (confirmation dialog) · archive /
restore · favorite (star) · mark as unread · pin (pins sort first) ·
mute (excluded from the unread badge) · typing indicator + canned
counterpart reply after each send · delivery states
(sending/sent/delivered/read ticks; read receipts flip on reply) ·
failed-send retry (`[fail]` convention) · online/away/offline presence ·
timestamps + date separators · author grouping within 5 minutes ·
rich previews (draft/unread/pin/star/last activity) · unread badges ·
"show earlier messages" reveal with skeleton (infinite-scroll
simulation) · system messages · file/image attachments (mock) · links ·
code blocks · markdown-lite · copy message · draft autosave (debounced,
per conversation) · Enter/Shift+Enter/Escape handling · character
counter (2000) · emoji/attachment/voice placeholders · details drawer
(participants with role/department/presence/last active, shared files,
media, links, mute/archive/delete).

## Files Modified

- `src/app/router/index.tsx` — messaging routes mounted; the Messages
  placeholder removed.
- `src/app/router/ShellBadgesProvider.tsx` — `messages` badge now reads
  the messaging feature's badge query.

## Files Created

The 14 feature files listed under Architecture, plus this document.

## Design Decisions

- **Workspace, not page**: no ContentHeader/summary cards; one bordered
  full-height panel (`100dvh` minus chrome) with internal scroll areas —
  a deliberately different rhythm from every registry page.
- **Own left rail**: folders/contacts are page chrome inside the
  workspace; the global sidebar is untouched.
- **Data seam parity**: store/service/query layering copies the
  notifications feature (single `window.localStorage` boundary,
  Promise service, invalidate-on-mutate, polled badge query), so a real
  transport slots in without component changes.
- **StrictMode lessons applied**: navigation after creating a thread
  uses a plain promise chain, mark-read effects are guarded by a
  previous-id ref, and the typing timer clears by its own id.
- **Canonical data only**: 5 contacts (4 roster doctors + patient Mona
  Adel), 5 conversations referencing the seeded entities (LAB-100001,
  LAB-100004 critical potassium, RX-200002, Layla's referral), 3
  attachments, 2 media-free link shares — nothing generated.

## UI Decisions

Chat bubbles: own messages right-aligned in `primary-subtle` with a
squared tail corner; others on `surface` with border; failed messages in
`error-subtle` with retry. Read ticks use the primary token; day
separators are hairline-flanked labels; the composer is a floating
bordered field that focuses to `primary`. Everything uses existing
tokens/components — no new colors, no inline styles, no dependencies.

## Mock Data

5 contacts, 5 conversations, 25 seed messages total, 3 attachments,
canned replies. Stored under `medora.messaging.v1` (seed written on
first run; defensive reads fall back to the seed).

## Responsive Behavior

- `lg+`: three panes (218px rail · 260–330px list · chat).
- `<lg`: the rail folds into a horizontal folder-chip row above the
  list; opening a thread swaps the list for the full-screen chat with a
  back button (list-or-chat slide behavior).
- Composer, drawers, and the contact modal reuse the existing
  responsive primitives.

## Accessibility

Arrow-key roving focus across the conversation list; `aria-current`,
`aria-pressed`, `aria-sort`-style state attributes on toggles; labeled
icon buttons everywhere; typing indicator and unread counts announced
via `role="status"`/labels; Enter/Shift+Enter/Escape composer handling;
dialogs/drawers keep the design system's focus management.

## Verification

- `npm run typecheck` · `npm run lint` · `npm run build` — all green
  (0 errors; the 14 pre-existing accepted react-refresh warnings).
- Manual browser pass as `doctor@medora.health`: folder counts, thread
  opening (unread clears + shell badge updates), send → typing → canned
  reply → read ticks, `[fail]` retry, star/pin/archive/delete, drafts
  autosave, details drawer, new-message flow, mobile list↔chat swap.

## Known Limitations

- Forward, emoji, attachments upload, and voice are placeholder toasts.
- Group-thread creation is out of scope (the seeded care-team thread
  demonstrates group rendering).
- The counterpart reply is canned and only simulates one participant.
- The notifications module keeps its lightweight per-patient chat tab;
  the full workspace lives here. Their stores are separate by design
  (`medora.messages.v2` vs `medora.messaging.v1`).
- Virtualization was skipped deliberately — five conversations render
  faster without it; `MessageBubble` is memoized instead.
- The main bundle crossed Vite's 500 kB pre-gzip warning threshold
  (158 kB gzipped) — a code-split candidate for a future phase.
