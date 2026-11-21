# Medora — Project Setup

**Phase 0 scaffolding** per `FRONTEND_ARCHITECTURE.md` §13.1.
Read the three source-of-truth documents before contributing:
`DESIGN_SYSTEM.md` · `UX_ARCHITECTURE.md` · `FRONTEND_ARCHITECTURE.md`.

## Requirements

- Node.js ≥ 20 (developed on Node 24)
- npm ≥ 10

## Installation

```bash
git clone <repo-url> medora && cd medora
npm install
cp .env.example .env.local   # adjust values if needed
npm run dev                  # http://localhost:5173
```

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | Type-check (project references) + production build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run typecheck` | TypeScript check without emitting |
| `npm run lint` / `lint:fix` | ESLint (includes architecture boundary rules) |
| `npm run format` / `format:check` | Prettier |

## Architecture Overview

Feature-based architecture with a one-way dependency rule (`FRONTEND_ARCHITECTURE.md` §1.2):

```
app → features → platform layers (components / layouts / hooks / api / types / utils)
```

- **Features never import each other** (exception: `features/shared-domain` via its public API).
- **Platform layers never import from features.**
- Both rules are ESLint build failures (`import/no-restricted-paths`), not conventions.

### Folder responsibilities

| Folder | Responsibility |
|---|---|
| `src/app/` | Composition root: providers, router + guards, error boundaries |
| `src/features/` | Domain modules (doctor/*, admin/*, auth, shared-domain) — see `src/features/README.md` |
| `src/components/` | Design-system implementation: `ui/` atoms, `patterns/` (P1–P8), `feedback/`, `charts/` |
| `src/layouts/` | App shell (Phase 3): AppShell, Sidebar, Navbar, PageHeader… |
| `src/routes/` | Route path constants + typed builders — the only source of hrefs |
| `src/hooks/` | Generic hooks (`useDisclosure`, `useDebouncedValue`, `useMediaQuery`) |
| `src/services/` | Framework-free side-effect services (preferences; audit dispatcher later) |
| `src/api/` | Transport: `ApiClient`, normalized `ApiError`, query-key factory, endpoints |
| `src/types/` | Cross-feature contracts: roles, permissions, API envelopes, branded ids |
| `src/utils/` | Pure functions only |
| `src/constants/` | Enumerated UI metadata (page sizes, debounce values, status maps later) |
| `src/configs/` | Zod-validated env, query-client defaults, feature flags, session policy |
| `src/styles/` | `tokens.css` (Design System §12.1) + `globals.css` |
| `src/assets/` | Fonts are npm-packaged (`@fontsource`); illustrations live here |

### Styling rules

- **No raw hex/palette classes in application code.** Use semantic Tailwind
  utilities only (`bg-surface`, `text-text-secondary`, `border-border`,
  `bg-primary hover:bg-primary-hover`). Theme switching is a CSS-variable
  swap (`.dark` on `<html>`), never a class change in components.
- Dark mode: toggled by `ThemeProvider`; a no-flash boot script in
  `index.html` applies the stored theme before first paint.

### Key contracts (already in place)

- `types/auth` — `Role`, `Permission`, `SessionUser`: guards, menus, and
  `useCan()` all derive from these unions.
- `types/api` — `ApiResponse<T>`, `Paginated<T>`, normalized `ApiError`.
- `types/common.ts` — branded entity ids (`PatientId`, `LabReportId`…):
  swapping ids across entities is a compile error by design.
- `api/client.ts` — access token in memory only; refresh cookie is
  httpOnly. Never store tokens or PHI in localStorage (lint-enforced).

## Phase Status

| Phase | Status |
|---|---|
| 0 — Scaffolding | ✅ this commit |
| 1 — Tokens & theme | ✅ folded into Phase 0 (`tokens.css`, ThemeProvider, Tailwind mapping) |
| 2 — Design-system core | ⬜ next (Button, Input, Card, Badge, Modal completion…) |
| 3 — App shell & routing | ⬜ guard structure exists; AppShell pending |
| 4 — Auth | ⬜ provider contract in place; implementation pending |
| 5–10 | ⬜ per `FRONTEND_ARCHITECTURE.md` §13.1 |
