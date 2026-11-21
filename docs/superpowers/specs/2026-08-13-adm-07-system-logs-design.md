# ADM-07 — System Logs (UX §3.7)

**Date:** 2026-08-13
**Checklist row:** ADM-07 · `frontend/FRONTEND_CHECKLIST.md` §4, Phase C item 12
**Spec of record:** `frontend/UX_ARCHITECTURE.md` §3.7 "System Logs"
**Status before this work:** 🟡 P0 — only a 5-row `AuditEvent` feed inside a settings
panel. No filters, no export, no saved views, not a page.

---

## 1. Purpose

§3.7 calls this "the platform's complete, immutable audit system — the source of
truth for every security investigation", and the user goal is "reconstruct
exactly what happened, who did it, and when — fast."

Today there is no such page. `/admin/logs` is declared in `routes.admin` and
mounted nowhere; the only audit surface is a five-row feed in ADM-09's settings
and the same feed on the ADM-01 overview. Neither can be filtered, exported, or
investigated with.

## 2. Module

New module `src/features/admin/logs/`, following the Phase C shape established
by `appointments/`, `doctors/`, `patients/` and `overview/`: pure rules, mock
service, query hooks, components.

```
src/features/admin/logs/
  logs.types.ts        LogEvent, LogCategory, LogEventType, LogFilters, SavedView, LogPage
  logs.ts              filtering · pivot · projection · taxonomy · formatters — pure
  logs.test.ts
  logs.api.ts          aggregation, paginated list, saved views, export logging
  logs.api.test.ts
  logs.queries.ts      useLogPage · useSavedViews · mutations
  SystemLogsSection.tsx    the page
  SystemLogsSection.test.tsx
  LogFiltersBar.tsx        search + six structured filters + saved views menu
  LogTable.tsx             the investigation table, with pivot affordances
  LogDetailDrawer.tsx      P3 — key-value grid, raw JSON toggle, incident reference
  SavedViewsMenu.tsx       apply / create-from-current-filters / delete
```

Mounted at `/admin/logs` as an admin section, the same way ADM-05 is — a
destination in its own right, not a clinic-management section.

`routes.admin.logs` is already declared, but **`AdminSectionSlug` does not
contain `'logs'`** — so mounting also means adding the slug to that union, an
entry to `SECTION_META`, and a sidebar item to `adminNavigation`. That is the
same three-file change ADM-01 made when it added `clinic`, and the compiler
finds every site because `SECTION_META` is a `Record` over the union.

## 3. Where the rows come from

The decisive design choice. §3.7's taxonomy covers events the other admin
modules **already record** in their own per-entity trails, so the log
aggregates those rather than inventing a parallel corpus. An administrator who
suspends a doctor on ADM-02 then finds that suspension in the log — which is
what makes this an investigation tool instead of a fixture.

| §3.7 category | Source | Notes |
| --- | --- | --- |
| Authentication | `DoctorRecord.logins` | Real `ip`, `device`, `location`, `result`, `impossibleTravel` |
| Authentication | `PatientAccount.events` of kind `sign-in`, `sign-in-failed` | No IP — see §3.1 below |
| Security | `phiAccessLog` (`PhiAccessEvent`) | PHI reveals, with justification category |
| Security | `PatientAccount.events` of kind `account-locked` | Lockouts. `lockCause` is *state*, not an event — it supplies the reason shown on the row, it is not itself a source |
| Admin activities | `DoctorRecord.audit` (`AdminAuditEntry`) | Verification decisions, suspensions |
| Admin activities | `PatientAccount.events` — the administrative kinds | Unlock, credential reset, deactivate, access grant/revoke |
| User actions | `OversightAppointment.events` (`OversightEvent`) | Appointment transitions, already carrying `actorRole` |
| System | **Seeded** | Service degradations, integration failures, job results |

### 3.3 Three sources are enums; two are free text

Classification is total over the enum sources: `LoginEvent.result`
(`success` · `failed` · `blocked`, plus the `impossibleTravel` flag),
`AccountEventKind` (13 values) and `OversightEventKind` (9 values) each map
onto a `LogEventType` exhaustively, and TypeScript enforces it.

`AdminAuditEntry.action` and `AuditEvent.action` are **`string`, not unions.**
In practice they carry a closed set — eleven distinct values written by
`audited()` in `doctors.api.ts` — but nothing at the type level says so, and a
new call site with a new string would classify as nothing.

So the classifier is a **total function with an explicit `other` fallback**,
and a test asserts **the fallback is unreached across the entire seeded corpus
and every string the app writes at runtime**. A new unmapped action string then
fails that test instead of silently landing in "other" and disappearing from
the event-type filter. This is the honest shape: the fallback exists because
the type system cannot rule the case out, and the test exists because the
fallback must never actually be used.

**Category vs event type.** `LogCategory` is one of §3.7's five taxonomy groups
(`authentication` · `security` · `user-action` · `admin-activity` · `system`) and
is what the projection in §4 selects on. `LogEventType` is the specific event
within a category — `login-failed`, `phi-revealed`, `doctor-suspended`,
`appointment-cancelled`, `data-export` and so on — and is what the toolbar's
event-type filter and the pivot operate on. Every `LogEventType` belongs to
exactly one `LogCategory`, declared as one map in `logs.ts` so the two can never
drift.

Only **System** is seeded. It is the one category no part of this frontend
records, because nothing here runs a service that can degrade.

### 3.1 Not every source carries every field

Doctor sign-ins carry an IP; patient account events do not, and neither do
appointment transitions. Rows without an IP render `—` and are **excluded by an
IP filter rather than silently matching it** — an investigator filtering by IP
is asking "which events came from this address", and a row that cannot answer
is not an answer. The same applies to device.

This is stated here because the alternative — inventing IPs for sources that
have none — would make the IP filter look more authoritative than it is.

### 3.2 Reused types

`ActorRole` (`'patient' | 'doctor' | 'administrator' | 'system'`) already exists
in `appointments/oversight.types.ts` and is imported rather than redefined.
`logs/` → `appointments/` is a one-way import; no cycle. §3.7 names three roles
(Doctor/Admin/System); the existing union's fourth, `patient`, is genuinely
needed because patient account events are one of the sources.

## 4. Relationship to `AuditEvent`

The log becomes the superset and the source of truth. `getAuditEvents()` in
`administration.api.ts` becomes a **projection of it**, so ADM-01's home feed
and ADM-09's audit panel keep working through one store rather than two that
can disagree.

**The projection selects on an explicit event-type allowlist, not on category.**
Selecting by category was the first design and checking it against the real
seed showed it is wrong: `admin-activity + security` drops two of the five
events `getAuditEvents()` returns today —

- `aud-2` "Automatic backup completed" is a job result, so it classifies as
  **system**;
- `aud-4` "Exported patient summary" is a doctor's export, which §3.7 lists
  under **user actions**.

Dropping them would silently remove two of five rows from ADM-01's home feed
and ADM-09's audit panel. Worse, it would quietly narrow the PHI regression
test in `administration.api.test.ts`, which iterates *every* event
`getAuditEvents()` returns and asserts none carries a patient name — `aud-4`
being the very event that once did. That test asserts only `length > 0`, so a
shrinking projection weakens it invisibly rather than failing.

So `AUDIT_FEED_TYPES` is a named set in `logs.ts` listing the `LogEventType`s
the summary feed surfaces: verification decisions, account lifecycle changes,
settings and role edits, PHI reveals, failed-attempt bursts, system job results
and integration failures, and data exports. Sign-ins and routine appointment
transitions are excluded — they are the high-volume sources, and they are what
would turn a six-row "recent admin activity" widget into a scroll of noise.

Two invariants get tests: **every one of the five legacy audit events survives
the projection**, and **no sign-in or routine appointment transition does**.

`AuditEvent`'s existing shape is unchanged, so no consumer is touched.

## 5. Pagination

`logsApi.list({ filters, sort, offset, limit }): Promise<LogPage>` where
`LogPage` is `{ rows: readonly LogEvent[]; total: number }`. Filtering, sorting
and counting happen **inside the service**, on the far side of the seam a real
API would sit behind. The page holds one page — 50 rows — never the whole log.

`sort` is `'newest' | 'oldest'` and orders by timestamp only. An investigation
log is read chronologically; sorting by severity or actor would let an
investigator believe they were seeing a sequence when they were seeing a
ranking. `total` is the count **after** filtering and is independent of
`limit`, so the pager can say "1–50 of 1,284".

§3.7 says the table expects 100k+ rows with virtual scrolling and server
pagination. The corpus here is a few thousand events spanning months, which is
enough to exercise filters, paging and date ranges. **The interface is the part
a real server must honour; the row count is not**, and 100k objects in a mock
would cost memory and test time to prove nothing.

## 6. The table

P1 investigation table. Columns per §3.7:

| Column | Notes |
| --- | --- |
| Timestamp | Millisecond precision, mono font, `tabular-nums` |
| Severity | Dot + badge (info / warning / critical) |
| Actor | Name + role chip |
| Event type | From the taxonomy |
| Summary | One line, never PHI |
| IP / device | `—` where the source carries none |
| `⋯` | View detail |

Critical rows tint `bg-error-subtle` (a real token — verified in
`tailwind.config.ts`).

**Toolbar.** Free-text search over actor, event type and summary — never over a
patient name, following the rule ADM-05 set for its own search. Structured
filters: actor role · actor identity · event type · severity · date-time range
with time precision · IP.

**Pivot.** Clicking an IP, actor or event type in a row sets that filter.
Following a trail becomes clicking rather than retyping, which is the
difference between a table you read and a table you investigate with.

## 7. Detail drawer (P3)

Structured key-value grid of the event's payload, a raw-JSON toggle, and
**Copy incident reference**. The reference is the event id plus its timestamp —
something an investigator can paste into a ticket.

## 8. Two rules with teeth

**Read-only for everyone, including admins.** §3.7 is explicit. No edit or
delete affordance exists in the UI, and — more to the point — `logsApi` exposes
**no mutation on events at all**. Attempting to change a log entry is a type
error rather than a policy someone can be talked past. The only writes the
service accepts are saved views and the export record.

**The export logs itself.** `logsApi.exportEvents()` appends a `data-export`
event *before* writing the file, so the export appears in the log it was taken
from. §3.7 requires it and it is directly testable: export, then assert the new
row is present.

Export is CSV and JSON, both honouring the active filters — an export that
quietly returned unfiltered rows would be worse than no export. CSV reuses
`toCsv` / `exportCsv` from `src/utils/export.ts`; JSON is added beside them.

Retention policy is displayed in the page caption, per §3.7.

## 9. Saved views (P7)

Persisted to `localStorage` under `medora.admin.logs.views.v1`, the pattern
`admin-settings.api.ts` already uses. A view stores a `LogFilters` snapshot and
a name. Operations: apply, create-from-current-filters, delete. Editing a view
in place is deliberately absent — delete and recreate is the same two actions
and one less state to hold.

Seeded with §3.7's own two examples: **"Failed logins 7d"** and **"Admin PHI
access"**.

## 10. States

- **Empty (over-filtered):** "No events match — widen the time range." §3.7's
  wording, because it names the fix rather than only the problem.
- **Loading:** skeleton rows in the table body, the toolbar staying interactive
  so a filter can be changed while the first page is in flight.
- **Error:** section error + Retry. Export failure raises a toast with retry,
  per §3.7.

## 11. Out of scope, and why

- **Correlated events** ("same session", "same actor ±5 min") — cut by scope
  decision. The aggregation would support it; it can be added without
  restructuring anything.
- **Before/after diff for mutations** — cut. The aggregated trails record what
  happened, not the prior value, so it would apply to a minority of events and
  need payload plumbed back into each source module.
- **Incident bookmarks** — cut. A second persistence model on top of saved
  views, consumed by nothing else.
- **Alert-rule configuration** — stays a link to ADM-09 Security, as §3.7 has it.
- **Virtual scrolling** — the paginated interface makes it unnecessary at this
  corpus size; it becomes relevant when a real server serves real volume.

## 12. Tests

- `logs.test.ts` — the pure layer: every filter including the IP-null rule;
  pivot produces filters that select the row pivoted from; **all five legacy
  audit events survive the projection and no sign-in or routine appointment
  transition does**; **the `other` classification fallback is unreached across
  the whole corpus**; every `LogEventType` maps to exactly one `LogCategory`;
  severity mapping; date-range boundaries.
- `logs.api.test.ts` — aggregation covers all five categories; a mutation
  performed on a source trail appears in the log; pagination returns a correct
  `total` independent of `limit`; export appends its own event; saved views
  persist across a reload; **the service exposes no event mutation**.
- `SystemLogsSection.test.tsx` — render, filter, pivot, drawer, export both
  formats, over-filtered empty state, saved view apply/create/delete, and that
  no edit or delete control exists anywhere on the page.
- A browser pass: filter, pivot, export, and confirm the export's own row
  appears in the log.

## 13. Documentation

`frontend/FRONTEND_CHECKLIST.md`: the ADM-07 row → done, with what shipped and
what did not; §4 intro; Phase C roadmap item 12; and the known-gaps section —
the log is frontend-only, so it records what this client can observe, not what a
server would record.
