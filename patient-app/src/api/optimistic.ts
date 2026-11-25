import type { QueryClient, QueryKey, UseMutationOptions } from '@tanstack/react-query';

import { captureLive } from './live-cache';

/**
 * The optimistic-update pattern — checklist R-07.
 *
 * ── One pattern, because the failure mode is always the same ─────────
 * An optimistic update is three steps that must all happen, in order,
 * and a hand-rolled one usually has two of them:
 *
 * 1. **Cancel** any in-flight refetch for the key. Without this, a
 *    response that left the server before the mutation lands after it
 *    and quietly restores the old value.
 * 2. **Snapshot, then apply.** The snapshot is the only thing that makes
 *    step 3 possible.
 * 3. **Roll back on failure, and re-fetch either way.** Not "on failure,
 *    invalidate" — an invalidation is a request, and a patient watching
 *    a value flip back after a round trip is watching a bug.
 *
 * `optimisticUpdate` returns those three as mutation callbacks, so the
 * call site supplies only the one thing that is actually per-mutation:
 * what the cache should look like if the server says yes.
 *
 * ── Where this may and may not be used ───────────────────────────────
 * Optimism is a claim about what the server will do, so it is only
 * honest where the client already knows the answer. Marking a
 * notification read is such a case: the value is the patient's own
 * client-side read state.
 *
 * **Appointment status is not**, and must never be made optimistic.
 * `pending → confirmed` is the clinic's decision, the checklist says
 * the status is rendered verbatim and the actions come from the server
 * (F-03, I-04), and an appointment that shows `cancelled` for a second
 * because this client assumed so is a clinical falsehood on screen. The
 * same holds for anything a clinician owns.
 *
 * ── Rolling back "visibly" ───────────────────────────────────────────
 * The rollback restores the cache; saying so is the call site's job,
 * through `onRollback`. A helper under `api/` that reached for a toast
 * would be a platform-layer module importing the component layer, which
 * is the one direction §3's layering rule forbids.
 *
 * `onRollback` rather than letting the call site pass its own `onError`
 * deliberately: an `onError` supplied next to this spread would REPLACE
 * the one below, and a rollback that silently stops happening because
 * someone added a message is exactly the bug this module exists to make
 * impossible.
 */

/** What `onMutate` hands to `onError`: everything needed to undo. */
export interface OptimisticContext {
  /**
   * Puts the snapshot back into the queries that are still live, and
   * reports whether the session that took it is still the current one.
   */
  readonly restore: () => boolean;
}

export interface OptimisticUpdateOptions<TVariables, TQueryData, TError> {
  readonly queryClient: QueryClient;
  /**
   * The key prefix the update touches. Every cached query under it is
   * snapshotted and rewritten, which is what makes a list and its
   * filtered variants move together.
   */
  readonly queryKey: QueryKey;
  /**
   * The cache as it should look if the server agrees. Called once per
   * matching query; a query that holds nothing yet is left alone.
   */
  readonly apply: (current: TQueryData, variables: TVariables) => TQueryData;
  /**
   * Runs immediately AFTER the cache has been put back, so the message
   * and the screen agree. Optional only because a rollback nobody can
   * see is still better than no rollback.
   */
  readonly onRollback?: (error: TError, variables: TVariables) => void;
}

type OptimisticCallbacks<TData, TError, TVariables> = Pick<
  UseMutationOptions<TData, TError, TVariables, OptimisticContext>,
  'onMutate' | 'onError' | 'onSettled'
>;

export function optimisticUpdate<TVariables, TQueryData, TData = unknown, TError = unknown>({
  queryClient,
  queryKey,
  apply,
  onRollback,
}: OptimisticUpdateOptions<TVariables, TQueryData, TError>): OptimisticCallbacks<
  TData,
  TError,
  TVariables
> {
  return {
    async onMutate(variables) {
      // Step 1. A refetch already on the wire would land after the
      // mutation and undo it.
      await queryClient.cancelQueries({ queryKey });

      // Step 2. Snapshot every matching query, then rewrite it. The
      // snapshot holds the Query instances themselves, not only their keys:
      // see the restore below.
      const live = captureLive(queryClient, queryKey);
      const snapshot = new Map(
        queryClient
          .getQueryCache()
          .findAll({ queryKey })
          .map((query) => [query, query.state.data as TQueryData | undefined] as const),
      );
      queryClient.setQueriesData<TQueryData>({ queryKey }, (current) =>
        current === undefined ? current : apply(current, variables),
      );

      return {
        restore: () => {
          // Only into the very query that was snapshotted. A sign-out
          // clears the cache while a request can still be on the wire, and
          // TanStack runs `onError` after `clear()`: writing by key would
          // re-create the previous account's data, or overwrite the next
          // account's query that has since taken the same key.
          for (const query of live.liveQueries()) {
            if (snapshot.has(query)) queryClient.setQueryData(query.queryKey, snapshot.get(query));
          }
          return live.isCurrent();
        },
      };
    },

    // Step 3a. Undo, immediately and locally — then let the call site
    // say so, in that order, so the message never describes a screen
    // that has not been put back yet. Only while the session that sent
    // the request is still the current one: after a sign-out there is
    // nothing of it on screen to describe, and the toast provider is not
    // session-scoped, so the message would land on the sign-in screen or
    // in the next account's session (`live-cache.ts`).
    onError(error, variables, context) {
      // No context: `onMutate` never completed, so nothing was changed and
      // the failure is this session's own.
      if (context === undefined || context.restore()) onRollback?.(error, variables);
    },

    // Step 3b. On either outcome the server is now the authority again.
    onSettled() {
      void queryClient.invalidateQueries({ queryKey });
    },
  };
}
