/**
 * Query-key factory conventions — FRONTEND_ARCHITECTURE.md §10.3.
 * Each domain registers its keys here through `createKeyFactory`, so
 * invalidation-by-prefix works uniformly:
 *
 *   const appointmentKeys = createKeyFactory('appointments');
 *   appointmentKeys.all            → ['appointments']
 *   appointmentKeys.list(filters)  → ['appointments', 'list', filters]
 *   appointmentKeys.detail(id)     → ['appointments', 'detail', id]
 *
 * Feature `api/` files own their factory instance; this module only owns
 * the convention.
 */

export function createKeyFactory<TDomain extends string>(domain: TDomain) {
  return {
    all: [domain] as const,
    lists: () => [domain, 'list'] as const,
    list: (params: Record<string, unknown>) => [domain, 'list', params] as const,
    details: () => [domain, 'detail'] as const,
    detail: (id: string) => [domain, 'detail', id] as const,
  };
}

export type KeyFactory = ReturnType<typeof createKeyFactory>;
