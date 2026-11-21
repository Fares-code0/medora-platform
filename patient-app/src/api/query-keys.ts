/**
 * Query-key factory — the port of `frontend/src/api/query-keys.ts`, so
 * invalidation-by-prefix works the same way in both clients.
 *
 *   const appointmentKeys = createKeyFactory('appointments');
 *   appointmentKeys.all           -> ['appointments']
 *   appointmentKeys.list(filters) -> ['appointments', 'list', filters]
 *   appointmentKeys.detail(id)    -> ['appointments', 'detail', id]
 *
 * Feature `api/` files own their factory instance; this module owns only
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

/**
 * Domains whose cached values are PHI and must never outlive a session.
 * `clearPhiCache` in `query-client.ts` walks this list on logout, on
 * session loss and on background timeout (checklist J-10, T-03, T-08).
 *
 * A new PHI-bearing feature adds its domain here. Forgetting to is the
 * kind of omission a review misses, so `query-client.test.ts` asserts the
 * sweep removes every listed prefix.
 */
export const PHI_QUERY_DOMAINS: readonly string[] = [
  'appointments',
  'health-records',
  'lab-results',
  'messages',
  'notifications',
  'profile',
];
