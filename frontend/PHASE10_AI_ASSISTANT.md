# Phase 10 — Doctor AI Assistant

Frontend-only implementation of the complete AI Assistant for the Doctor
dashboard at `/doctor/ai`: an AI dashboard (status + activity hub + prompt
library), a full chat workspace with simulated streaming, context modes
grounded in the Phase 3–8 clinical modules, local conversation-history
management, and locally-persisted assistant settings. Built entirely from the
Phase 1 component library — **no real AI, no backend, no new packages**; the
"model" is a deterministic mock service behind TanStack Query.

## Routes

| Path | Page | Crumb |
| --- | --- | --- |
| `/doctor/ai` | `AiAssistantPage` (dashboard + chat, one lazy chunk) | AI Assistant |

`routes.doctor.assistant` now resolves to `/doctor/ai`, so every existing
consumer (sidebar "AI Assistant", navbar shortcut, Overview dashboard widgets,
Patient Profile header) re-pointed automatically — the router placeholder was
retired and `aiRoutes` mounted in `src/app/router/index.tsx`.

**URL contract** (all state is shareable):

- `?c=<conversationId>` — open a conversation.
- `?context=patient|record|labs|pharmacy&patientId=<id>&refId=<entityId>` —
  contextual entry point: seeds a new grounded conversation (honoring the
  auto-context setting) and redirects to its `?c=`.

**"Ask AI" entry points** (all navigate with the context params):

- Patient Profile identity header → `context=patient`
- Medical Record detail quick actions → `context=record&refId=<recordId>`
- Lab result detail quick actions → `context=labs&refId=<labId>`
- Prescription detail quick actions → `context=pharmacy&refId=<rxId>`
- Main dashboard AI widget / quick actions → plain `/doctor/ai`

## Folder structure

```
src/features/doctor/ai/
├── api/
│   └── useAiQueries.ts            # TanStack Query list + update/delete mutations,
│                                  #   sync create (navigation must never wait on a
│                                  #   droppable mutation callback)
├── components/
│   ├── AiDashboard.tsx            # Welcome/status card, recent chats & analyses,
│   │                              #   favorite + suggested prompt sections
│   ├── ChatPanel.tsx              # Context bar, thread, suggestions, composer
│   ├── ChatMessageBubble.tsx      # User/assistant turns, copy/regenerate/retry,
│   │                              #   timestamps, stopped/error states, StreamingBubble
│   ├── ChatComposer.tsx           # Enter-to-send textarea; Send ⇄ Stop while generating
│   ├── MarkdownContent.tsx        # Dependency-free markdown renderer + code blocks
│   │                              #   with copy + token highlighting (semantic colors)
│   ├── TypingIndicator.tsx        # Pulsing dots (reduced-motion safe)
│   ├── PromptCards.tsx            # Reusable prompt cards with favorite star
│   ├── ConversationListPanel.tsx  # Search / open / rename / favorite / delete
│   └── AiSettingsDrawer.tsx       # Temperature, length, language, auto-context, streaming
├── hooks/
│   ├── useAiSettings.ts           # Settings state, written through to localStorage
│   └── useChatSession.ts          # Send/stream/stop/retry/regenerate state machine
├── mock/
│   └── mock-ai-service.ts         # The swappable "backend" (CRUD + generation)
├── model/
│   ├── types.ts                   # Modes, messages, conversations, settings + P8 meta
│   ├── prompts.ts                 # 6 suggested prompts (context-affinity ranked)
│   ├── responses.ts               # Deterministic clinical markdown responses
│   └── store.ts                   # localStorage boundary (conversations + settings)
├── pages/
│   └── AiAssistantPage.tsx        # Orchestrator: URL state, seeding, layout
├── routes.tsx                     # Lazy route object with breadcrumb handle
└── index.ts                       # Public API: routes only
```

**Touched outside the feature (integration, additive):** `src/routes/index.ts`
(`assistant` → `/doctor/ai`), `src/app/router/index.tsx` (mounts `aiRoutes`,
drops the placeholder), and the four quick-action components listed above
(placeholder AI toasts became real navigation).

## Architecture

- **Feature-based module** mirroring Phases 3–8: `model/` is pure data +
  logic, `api/` is the TanStack Query seam over the mock service, pages own
  URL state, components are presentational.
- **Chat state machine** (`useChatSession`): phases `idle → thinking →
  streaming`; a monotonic generation token supersedes in-flight work
  (regenerate, stop, StrictMode double-effects) instead of racing it; the
  streaming interval clears itself by id so a superseded stream can never
  leak. Local message state is authoritative for the open conversation; every
  finalized message is persisted through the update mutation.
- **Simulated streaming**: the mock resolves the full response, the UI
  reveals ~3 words / 45 ms; Stop mid-stream keeps the partial text (persisted
  as `stopped` with a visible note); the streaming toggle switches to
  all-at-once.
- **Message actions**: copy (all messages), regenerate (last answer), retry
  (failed generation — drops the error bubble and re-runs, always succeeding
  on attempt 2), timestamps on every turn.
- **Context modes**: general / patient / record / labs / pharmacy. Contextual
  entries seed a conversation with a grounded greeting, a removable context
  chip ("Laboratory · LAB-100429 · Hassan Shahin"), and a title; the mode
  Select re-grounds an existing chat; patient names resolve from the shared
  `patient-identity` roster (the only sanctioned cross-feature import).
- **Prompt library**: six reusable cards (summarize patient, explain labs,
  drug interactions, differential diagnosis, review medications, explain
  imaging), affinity-ranked per context, favoritable (persisted), usable from
  the dashboard (starts a chat) and from an empty chat.
- **History management**: search, open, rename (Modal), favorite
  (favorites sort first), delete (ConfirmationDialog); sidebar column on lg+,
  Drawer below.
- **Settings**: temperature, response length (shapes the canned responses),
  language (annotated mock), auto-context, streaming — all persisted in
  localStorage with a reset-to-defaults.
- **AI provenance (UX 1.5 / DS §7.3)**: every assistant surface uses the
  accent AI container (violet border/subtle background, Sparkles), `variant="ai"`
  buttons, and a fixed "supports, never replaces, clinical judgment"
  disclaimer under the composer and inside every response.

## Components used (existing only)

`Card`, `Button`, `IconButton`, `LinkButton`, `Badge`, `Chip`, `Avatar`,
`Select`, `Switch`, `Input`, `Textarea`, `SearchInput`, `Modal`,
`ConfirmationDialog`, `Drawer`, `Dropdown`, `Tooltip`, `Breadcrumb`,
`StatusBadge`, `Fact`/`FactGrid`, `ContentHeader`, `PageContainer`, `Stack`,
`Grid`, `Section`, `Alert`, `EmptyState`, `Skeleton`, plus `useDisclosure` /
`useMediaQuery` and the `utils/dates` formatters. The markdown renderer and
typing indicator are feature-internal compositions styled exclusively with
design tokens — no new UI primitives, no inline styles, no hardcoded colors.

## Mock service & data model

`mock/mock-ai-service.ts` is the swappable backend:

- **Conversation CRUD** — async with ~250 ms latency over the localStorage
  store (`model/store.ts`, seeded with two example chats on first run).
  Creation alone is synchronous: it gates `?c=` navigation, which must never
  depend on an async mutation callback React can drop across remounts.
- **`generateAssistantReply`** — ~0.9–1.4 s "thinking" latency, then a
  deterministic markdown response from `model/responses.ts`, selected by
  suggested-prompt id or context mode and trimmed to the response-length
  setting. Responses include headings, lists, tables, and code blocks
  (e.g. a free-water-deficit calculation) to exercise the renderer.
- **Failure simulation** — a stable ~10 % hash bucket of prompts and any
  prompt containing `[fail]` throw `AI_GENERATION_FAILED` on the **first**
  attempt only, so Retry demonstrably succeeds.

Strongly-typed models: `AiConversation`, `ChatMessage` (role/status/error),
`AiConversationContext` (mode + patient/ref ids only — no PHI),
`AiSettings`, `AiPrompt`. Conversations and settings persist under
`medora.ai.*` keys; the store module is the feature's single storage
boundary (same pattern as the auth session store).

## Future API integration points

| Seam | Today | Later phase |
| --- | --- | --- |
| `mock/mock-ai-service.ts` | Canned generation + localStorage CRUD | Assistant endpoints (SSE/WebSocket streaming); `useChatSession` already models token-revealing, stop, and retry |
| Sync `createConversation` | localStorage write before navigation | Router action / optimistic id from `POST /conversations` |
| `model/responses.ts` | Deterministic markdown builder | Deleted — server generates |
| `model/store.ts` | Browser persistence | Server-side conversation storage |
| Context params (`?context=…&refId=…`) | Ids resolved against mock rosters | Same contract; server resolves and injects real clinical context |
| Settings | localStorage | User-preferences endpoint; temperature/length/language become real model params |

## Verification

`npm run typecheck`, `npm run lint` (0 errors; the 14 react-refresh warnings
are pre-existing and accepted), and `npm run build` all pass. Manually driven
in the browser on the running app: auth-guarded entry with `returnTo`, the AI
dashboard (status card, activity hub, favorites), prompt-card → new chat →
simulated streaming with markdown/table/highlighted-code/copy, stop-mid-stream
(persisted `stopped` + note), forced `[fail]` error → Retry success,
regenerate affordance, contextual entry `?context=labs&refId=LAB-100429`
(seeded grounded chat + chip + greeting + ranked suggestions), history drawer
with search and rename/favorite/delete menus (favorite verified persisted),
settings drawer, and the responsive mobile layout (History drawer variant).

## Out of scope (per Phase 10 brief)

No backend, no real AI integration, no PHI in storage. The language setting is
annotated mock (responses stay English); temperature is recorded but only a
real model can apply it.
