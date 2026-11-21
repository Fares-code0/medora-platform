# ADM-06 Sub-project B — Communication Monitoring

**Date:** 2026-08-18
**Checklist row:** ADM-06 · `frontend/FRONTEND_CHECKLIST.md` §4 — **this sub-project closes it**
**Spec of record:** `frontend/UX_ARCHITECTURE.md` §3.6
**Depends on:** ADM-06 sub-project A (`docs/superpowers/specs/2026-08-18-adm-06a-foundations-design.md`, PR #17) — the shared conversation model and the reusable access gate both land there.

---

## 1. Purpose

Governance of the messaging system. The user goal §3.6 states is the whole design
brief:

> "Ensure communication is safe and compliant without routinely reading anyone's
> messages."

Every decision below follows from the second half of that sentence. The screen
exists so that an administrator can supervise communication *without* reading it,
and reading is the exception — gated, justified, time-boxed, watermarked and
logged. A design that made content easy to reach would satisfy the feature
request and fail the requirement.

## 2. Decisions taken

Five questions were settled before design. They are recorded here with their
reasoning, because each closes off an alternative that would otherwise look
reasonable to a later reader.

| Decision | Rejected alternative | Why |
| --- | --- | --- |
| All three tabs in one spec | Split into logs-first / flags-first | The tabs are three views of one derived document; splitting would leave two specs editing one api file. Matches ADM-01 (10 tasks) and ADM-07 (11 tasks). |
| Flags derived by a pure rule module over the shared seed | A hand-authored flag corpus | A stored excerpt is a second copy of a message that already exists — the divergence sub-project A spent four tasks removing. |
| Content access self-serve, gated on `communications.viewContent` | Second-admin approval workflow | §3.6 licenses this explicitly with "if configured". One seeded admin account cannot demonstrate an approval workflow; an approver who approves their own request proves nothing. |
| Viewer is a full route | Drawer or modal over the table | The unauthorised-direct-access defence only exists if there is a URL to attack. A drawer cannot exercise it. |
| Escalation navigates to the owning screen | Writing suspension directly from the flag drawer | ADM-02/03 and ADM-04 own suspension with their own reason capture and audit write. A second implementation is a hardening fix that reaches one and misses the other. |

**One consequence accepted deliberately:** the aggregates are computed from real
seeded data, and the shared seed is five conversations because Phase 12 cut every
module to five canonical entities. The volume trend will be sparse and the
medians computed over a handful of messages. Truthful small numbers are preferred
to padding the shared seed, which would also bloat the doctor's inbox at
`/doctor/messages`.

## 3. Architecture

New feature at `frontend/src/features/admin/communications/`, following the file
shape ADM-04 and ADM-07 established.

| File | Responsibility |
| --- | --- |
| `communications.types.ts` | `ConversationRow`, `CommunicationsOverview`, `SafetyFlag`, `FlagStatus`, `FlagCategory`, `AccessRef`, `ContentAccessCategory` |
| `communications.ts` | Pure derivations — rows, the five aggregates, filter and sort |
| `flag-rules.ts` | The four detectors and the deterministic flag id |
| `communications.api.ts` | Mock service over the shared store plus `medora.admin.communications.v1` |
| `communications.queries.ts` | Query keys and hooks |
| `CommunicationsSection.tsx` | Three-tab shell |
| `OverviewTab.tsx` · `ConversationLogsTab.tsx` · `SafetyFlagsTab.tsx` | The tabs |
| `ContentAccessDialog.tsx` | Justification modal, instantiating `audited-access` |
| `ConversationViewerPage.tsx` · `WatermarkOverlay.tsx` | The gated reader |
| `FlagResolveDialog.tsx` | Resolve / warn / escalate, each with a reason |

### 3.1 Routes and navigation

- `/admin/communications` — the section. Requires a new `communications` member in
  `AdminSectionSlug` (`frontend/src/routes/index.ts`), its `SECTION_META` entry,
  and an `adminNavigation` item.
- `/admin/communications/:conversationId` — the gated viewer, a child route.
- Tab selection is URL-owned as `?tab=overview|logs|flags`, matching ADM-04's
  `PatientTabs`.

**Sequencing note learned from ADM-07:** the slug union and `SECTION_META` entry
must be added in the same task that first renders a `SectionShell` for this
section, or typecheck cannot pass. The nav entry and route mount may come later.

### 3.2 The two stores stay separate

The shared `medora.messaging.v1` document is **read-only from this feature**. The
admin area never writes a message, never marks one read, never archives a thread.
Everything this feature mutates lives in its own `medora.admin.communications.v1`:
flag status overlays, resolution notes, and the content-access log.

This is what makes the whole admin surface safe to exercise: no sequence of
actions here can corrupt the doctor's inbox.

### 3.3 Three capabilities gate three different things

ADM-09's permission matrix already defines them, with descriptions written in
anticipation of this screen:

| Capability | Gates | Held by |
| --- | --- | --- |
| `communications.viewMetadata` | The section itself — absent, it is not in the nav and the route denies | admin, doctor, reception |
| `communications.viewContent` | The request-access affordance and the viewer route. Carries `phi: true` and `lockedOff: ['laboratory','pharmacy']` | admin |
| `communications.resolveFlags` | The resolve actions on the flags queue | admin |

A role holding metadata only sees a complete, useful screen with no content
affordances. That is the point of having three capabilities rather than one, and
it is the behaviour to test — not the happy path where an admin holds all three.

The matrix's own `lockReason` — *"Content access is limited to oversight and
clinical roles."* — is the policy reason the denial alert renders. It is not new
copy to invent.

## 4. Data flow

**One query, one document.** `useCommunicationsQuery()` returns
`{ rows, overview, flags }`, all three derived in a single pass from
`readStoredConversations()` plus the admin-local overlay. The tabs are views onto
that one object, so the flag rate on Overview *is* the length of the flags array
rather than a second count of the same fact.

This is ADM-01's rule — nothing is fetched that another screen already knows —
applied one level down. ADM-07 hit the concrete version of the failure it
prevents: the same PHI reveal reachable through two paths under different ids,
which dedupe-by-id could not catch.

### 4.1 Flag identity

A derived flag has no natural id. It gets a deterministic one from
`conversationId + messageId + category`, via the existing `hashString` helper.

Status transitions write an **overlay record keyed by that id**; the flag itself
is never persisted. The consequence is intended: a flag whose source message
stops matching its rule disappears, and its overlay becomes unreachable. There is
no such thing as an open flag on a message that no longer trips anything.

### 4.2 Patient identifiers go through ADM-10

The metadata table names the doctor and renders the patient through
`MaskedIdentifier`. This matters more here than on other admin screens: a feature
built to avoid reading private messages must not leak identity in the row that
describes them.

## 5. The content-access gate

Request → `ContentAccessDialog` collects a justification category and a free-text
reason → `audited-access`'s `grantFor` issues a time-boxed grant under this
feature's own category union and minimum reason length → the grant lives in a
`ContentAccessProvider` → `ConversationViewerPage` renders only while `isLive`
holds.

**Justification categories** (§3.6): patient complaint, safety flag, legal
request, quality audit. This is a different union from PHI's five, and the policy
values differ too — that parameterisation is exactly what sub-project A extracted
`audited-access` to provide.

| Policy value | PHI (ADM-10) | Communications | Why it differs |
| --- | --- | --- | --- |
| Minimum reason length | 12 | **20** | Reading an entire private thread is more invasive than revealing one identifier, and warrants a justification an auditor can actually evaluate |
| Grant TTL | 15 minutes | **10 minutes** | Reading a five-message thread does not need a quarter hour, and a shorter window means fewer grants outlive the task that justified them |

These are the only two policy numbers this feature chooses. Both live in
`communications.ts` as named constants, never inline, so the expiry test and the
retention copy read the same source.

**The reference number is not a new identifier.** At grant time the feature
writes a `communication-content-accessed` log event, and *that event's id* is the
`ref #` in the banner "You are viewing private communication — access logged
(ref #)". The reference an admin reads on screen is the row an auditor finds in
`/admin/logs`. Minting a separate reference would create two identifiers for one
event and guarantee they eventually disagree.

**Watermark.** The reading surface carries a repeating diagonal overlay bearing
the acting admin's name, plus the persistent banner. Both are presentation, not
protection — the protection is the grant and the log — and the spec should not
imply otherwise.

**Termination.** Expiry, navigating away, and an error inside the viewer all take
one path: the grant is dropped, the route tears down to the table with a notice,
and the access log entry closes as incomplete. §3.6 requires the incomplete case
explicitly.

## 6. Safety flags

**Categories** (§3.6): emergency language, harassment/abuse, PHI-in-wrong-channel,
prescription solicitation.

**Detection** is a pure rule module. Each detector is a named function over a
message body, tested against positive *and* negative fixtures. A detector that
matches everything is as broken as one that matches nothing, and only the
negative cases catch the first kind.

### 6.1 The false-positive premise does not apply uniformly

*Amended 2026-08-18, during implementation, by the user's decision.*

The premise above — that the false positive is the expensive failure, because a
noisy queue teaches a reviewer to dismiss it unread — produced a suppression
mechanism where any "negative" keyword appearing anywhere in a message cancels
the rule. Implementation showed that mechanism is unsound in both directions.
Three verified false positives were fixed by adding guards; the guards then
produced a verified false *negative*: `unconscious patient, post-op, needs
urgent help` raised no flag at all, because a bare `post-op` match cancelled it.

A negative guard keyed on one topical word appearing anywhere will always be
either too broad or useless. So the premise is now scoped rather than global:

- **`emergency-language` carries no negative guards.** A false positive there
  costs a reviewer ten seconds; a false negative costs a patient. The premise
  does not apply to this category and never did — the cost asymmetry runs the
  other way.
- **The other three categories keep negatives**, narrowed from topical keywords
  to phrase-level *routine documentation* signals — `came back clear`,
  `all normal`, `no complications` — which characterise the whole message rather
  than merely naming its subject.
- **`prescription-solicitation` fires only on phrases that carry the intent
  explicitly** — `without a prescription`, `refill it early`, `no questions
  asked`, `don't tell my doctor`. Controlled-drug names are not a trigger at
  all, and this rule carries no negative guards either. *(Amended again after a
  third review round — see 6.2.)*

This asymmetry is the design, not a compromise. Two categories with opposite
cost profiles should not share one suppression policy.

### 6.2 Why solicitation detects phrases and not intent

*Amended 2026-08-18 after the third review round, by the user's decision.*

An intermediate design made a drug name a positive when it co-occurred with a
request cue. Review showed that mechanism miscalibrated in both directions at
once: `Can you confirm the oxycodone dose was administered at 2pm?` flagged as
drug-seeking, while `I want alprazolam today` and `oxycodone. now.` escaped
because neither used a listed cue verb. Its negative guards were separately
defeatable — dropping a routine phrase into a live demand suppressed it
(`Can you send oxycodone? The refill is ready but I need it now anyway.`).

The root cause is not tuning. **`prescription-solicitation` is the only one of
the four rules whose definition is an intent rather than a surface fact.** The
other three detect things regex genuinely expresses — symptom phrases,
record identifiers, explicit abusive phrases — and all three are stable. Intent
is not expressible this way, and three rounds of pattern tuning demonstrated it
rather than fixing it.

So the rule now promises less, honestly: it detects **phrases that carry the
intent on their face**, and nothing else. The accepted cost is stated here
rather than discovered later — `I want alprazolam today` does not flag. That is
the correct limit for a module this spec already describes as deterministic
rules and explicitly not a classifier, and a false accusation of drug-seeking
attached to a named clinician is a worse outcome than a missed phrasing.

### 6.3 What auto-flagging does not do

*Amended 2026-08-18 after the fifth review round, by the user's decision.*

**Auto-flagging is a keyword heuristic with known poor recall on phrasing it
has not been given.** This is measured, not estimated. One review round widened
`emergency-language` until it caught all thirteen phrasings the previous
reviewer had named; the next reviewer invented twenty-two fresh ones across the
same categories and **one** matched. Missed phrasings included `pain in my
chest` (the vocabulary has `chest pain`, and word order is load-bearing), `lips
are blue` (it has `turning blue`), `convulsions`, `barely breathing`,
`hemorrhaging`, household-chemical and button-battery ingestion, and indirect
self-harm such as `I have the pills ready`.

Adding the missed phrases would repeat the cycle rather than end it. A fixed
phrase list cannot cover natural language, and three rounds of evidence say so.

**Why that is acceptable here, and the calibration error it corrects.** Earlier
review rounds — and the briefs that produced them — treated this queue as a
patient safety net, which made every miss Critical. It is not one. §3.6 defines
this screen as *governance*: aggregate health, policy enforcement, and gated
content review. It is **retrospective oversight, not a triage path**. A message
that fails to flag is still in the doctor's inbox and still in front of the
clinician it was sent to; what a missed flag costs is an administrator not
later reviewing that thread. Real triage is the doctor's job and always was.

Two obligations follow, and both are requirements:

1. **The Safety flags tab must say so on screen.** Copy to the effect that
   automatic flagging is keyword-based, catches only some phrasings, and is not
   a substitute for clinical triage. An administrator who believes this queue
   catches every emergency is worse off than one who knows it does not — a
   false assurance is the real hazard here, not the missed keyword.
2. **`flag-rules.ts` carries the same statement in its module header**, so the
   next person to widen the vocabulary knows what widening can and cannot buy.

**Seed.** The shared conversation seed gains a small number of clinically
plausible flaggable messages — a patient reporting chest pain (emergency), a
patient pressing for a controlled substance (solicitation), an identifier pasted
into chat (PHI-in-wrong-channel). These read as realistic in the doctor's inbox,
which is where they will also appear. **Harassment/abuse remains a supported
category with no seeded instance**: there is no inoffensive seed for it, and
polluting a shared demo inbox to populate a queue is the wrong trade. Its detector
is tested against fixtures rather than seeded data.

**Excerpts are minimum necessary context** (§3.6) — the matched message only,
never the surrounding thread. Reading the thread requires the gate.

### 6.4 Excerpts are masked, not verbatim

*Amended 2026-08-18 after browser verification, by the user's decision.*

"The matched message only" was written as though limiting the *extent* of an
excerpt were enough restraint. Browser verification showed it is not. The
`phi-wrong-channel` rule fired on two pre-existing seeded messages and the
queue printed them verbatim:

> "Dr. Youssef Nabil created this care-team thread for Omar Farouk (MRN 4472-90)."
> "I am referring Layla Mansour (MRN 4485-33) to you — exertional chest tightness…"

Full name and record number, in cleartext, ungated and unlogged, to any
administrator holding only `communications.viewMetadata` — the same capability
under which the metadata table one tab away renders that patient as `Mo••• A•••`.
The feature's own masking rule was contradicted one tab apart.

The failure is specific to what this rule detects. For `phi-wrong-channel` the
matched message **is** the leak by definition, so a queue that quotes the match
republishes the identifier into a screen with a wider audience than the thread
it came from. The category that exists to catch an identifier in the wrong
channel had become one.

**So excerpts render through the same masking as the metadata table.** A flag
reads `Cross-check against PT-••••` and `referring M••••• M••••• (MRN ••••-••)`.
The reviewer still sees that an identifier was posted, and by whom, and when —
which is the whole signal the flag carries. Reading the actual number is what
the content gate is for, and wanting to read it is exactly the moment a
justification should be required.

This applies to every category, not only `phi-wrong-channel`: any message can
name a patient, and the queue cannot know in advance which does.

**Workflow.** Open → Under review → Resolved. Resolution is one of:

- **Dismiss with note** — status and note recorded.
- **Warn user** — recorded; no cross-feature write.
- **Escalate** — marks the flag `escalated` and routes to `/admin/doctors/:id` or
  `/admin/patients/:id` carrying the flag reference, where the existing tested
  suspension or account-flag flow captures its own reason and performs the write.

Each transition is a P4 with a reason and writes to the communications log.

## 7. Overview tab

Aggregate analytics only. **No message content appears on this tab under any
condition** — not in a tooltip, not in a chart label, not in an empty state.

Five figures, all derived. Each is defined here because four of the five names in
§3.6 admit more than one reading, and two implementations that both look correct
would disagree:

| Figure | Definition |
| --- | --- |
| Message volume trend | Messages per day over a trailing 14-day window, counted by `sentAt`, all participants |
| Median doctor response time | Over every patient message that received a doctor reply in the same conversation, the median gap to the next doctor message. Patient messages still awaiting a reply are excluded — they are the next figure, and counting them here would drag the median by the age of the oldest unanswered thread |
| Unanswered over 48h | Conversations whose most recent message is from a patient and is older than 48 hours. Boundary is exclusive: exactly 48h is not yet unanswered |
| Active conversations | Conversations with at least one message in the trailing 14 days and not archived |
| Flag rate | Conversations carrying at least one flag of any status, over active conversations. Conversation-level, not message-level, so one thread with three flags counts once |

The trend renders through the existing hand-rolled chart library at
`@/components/charts`; the project has no third-party charting dependency and none
is to be added.

## 8. Cross-links closed

Three parked comments in shipped code name ADM-06 as their blocker. All three
close here.

1. **`LogEventType` gains `communication-content-accessed`** with its category
   mapping and a pinned test. Without it the single most sensitive action in the
   admin area logs as `other`.
2. **ADM-01's action queue gains its fifth row** — flagged conversations, derived
   from the flags document, carrying its destination with the filter applied, as
   the other four rows do.
3. **ADM-01's `SecurityAlertKind` gains flagged communications**, which §3.1
   names and `overview.types.ts` deliberately omitted.

Closing these means ADM-01's and ADM-07's suites become part of this branch's
gate. That is the cost of the cross-links and is accepted.

## 9. States and error handling

§3.6 names several states that are easy to skip because each is a failure or an
absence:

- **Denial.** Lacking `communications.viewContent` renders §3.6's info alert with
  the policy reason and the role that carries the capability — not a disabled
  button. Reaching the viewer URL directly without a live grant lands on the table
  with that same alert, and the attempt is logged.
- **Expiry mid-read.** Covered in §5.
- **Empty flags queue.** `"No open flags ✓"`, verbatim from §3.6, and reachable by
  resolving every flag rather than only against an unseeded store.
- **Loading and error.** The admin area's standard async envelope, one per tab, so
  a failure on Overview does not blank the section.

**The governing rule is fail closed.** Any uncertainty about a grant — a malformed
overlay, an unparseable store, a conversation id resolving to nothing — denies
access rather than defaulting open. In a module whose purpose is restraint, an
error that reveals content is worse than one that hides it.

## 10. Testing

| File | Covers |
| --- | --- |
| `flag-rules.test.ts` | Each detector against positive **and** negative fixtures; id determinism; that ids differ across categories on one message |
| `communications.test.ts` | The five aggregates against a fixture with known answers, including the unanswered-over-48h boundary; filter and sort |
| `communications.api.test.ts` | The access log's append-only property asserted via the api's exact key surface (as ADM-07 does); that one gated read writes exactly one event; that the banner ref equals that event's id |
| `CommunicationsSection.test.tsx` | Each of the three capability gates, proven by a role lacking it seeing the denial rather than the affordance |

Two behaviours must be **mutation-proven**, because both pass a naive test while
broken:

1. The denial path is reached by the *absence of the capability*, not by a loading
   gate that happens to render the same thing. (ADM-01 shipped exactly this bug
   and it took a second fix round.)
2. The viewer renders nothing at all when the grant is expired — not a shell, not
   a header, not a watermark over an empty surface.

## 11. Out of scope

- **Second-admin approval** for content access. §3.6 makes it conditional on
  configuration; this deployment does not enable it. No dead toggle is added.
- **Content export.** §3.6 permits it under elevated permission as a logged,
  watermarked artifact. Aggregate export is in scope; content export is not, and
  no partial affordance ships.
- **Participant-visible transparency logs.** §3.6 says "where policy requires" —
  no patient-facing surface exists to render them.
- **Real classification.** The detectors are deterministic rules over seeded text.
  They are not a safety classifier and must not be described as one in UI copy.
- **`FRONTEND_ARCHITECTURE.md` §9.1's stale `types/domain/` registry** and the
  four duplicated `validateReason` implementations — both are sub-project A
  follow-ups, unrelated to this screen.

## 12. Baseline to preserve

At the branch point (`542fb5b`): **44 test files, 552 tests, typecheck clean, lint
0 errors (20 pre-existing `react-refresh` warnings), build green.** Test count
rises; no existing test may change or fail. `npm run format:check` is known-red on
565 pre-existing files (CRLF versus `endOfLine: lf`) and is not a gate.

The doctor's messaging suites and the PHI suites are both downstream of the shared
modules this feature reads. Neither should need editing; if one does, this feature
has reached into something it should not have.
