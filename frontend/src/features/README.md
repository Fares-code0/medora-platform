# Features

Feature modules per `FRONTEND_ARCHITECTURE.md` §3. Every module follows the same anatomy:

```
<feature>/
├── index.ts      # PUBLIC API — the only import surface for other code
├── routes.tsx    # lazy route objects consumed by app/router
├── pages/        # route-level components
├── components/   # feature-specific components
├── api/          # endpoint fns + TanStack Query hooks + query keys
├── model/        # feature types, Zod schemas, status machines, mappers
└── hooks/        # feature hooks (URL-state bindings etc.)
```

## Boundary rules (lint-enforced)

1. Features never import from other features — the only exception is
   `shared-domain`, imported through its `index.ts` public API.
2. `components/`, `layouts/`, `hooks/`, `api/`, `utils/` (the platform
   layers) never import from `features/`.
3. Deleting a feature folder must break nothing except its routes.

## Modules (implemented in Phases 7–8)

- `auth/` — login, 2FA, session lock (Phase 4)
- `doctor/` — dashboard, patients, medical-records, appointments,
  ai-assistant, labs, pharmacy, messages, notifications, reports, settings
- `admin/` — dashboard, doctors, patients, appointments, communications,
  system-logs, reports, settings
- `shared-domain/` — patient-identity, appointment-core, scheduling, audit
