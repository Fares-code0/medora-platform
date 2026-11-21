import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Draft/dirty tracking for a settings section that batches its edits behind
 * a sticky Save/Cancel bar. `saved` is the persisted value from the query;
 * the hook keeps a local draft, reports whether it diverges, and re-syncs
 * whenever `saved` changes (i.e. after a successful save writes the cache).
 *
 * The sync is guarded by a serialized ref so a StrictMode double-invoke or
 * an unrelated re-render can't wipe an in-progress edit — draft only resets
 * when the persisted value genuinely changes.
 */
export function useEditableSection<T>(saved: T) {
  const savedKey = JSON.stringify(saved);
  const [draft, setDraft] = useState<T>(saved);
  const lastSavedKey = useRef(savedKey);

  useEffect(() => {
    if (lastSavedKey.current !== savedKey) {
      lastSavedKey.current = savedKey;
      setDraft(saved);
    }
  }, [savedKey, saved]);

  const dirty = JSON.stringify(draft) !== savedKey;

  const reset = useCallback(() => {
    setDraft(saved);
  }, [saved]);

  /** Patch a subset of fields on the draft object. */
  const patch = useCallback((fields: Partial<T>) => {
    setDraft((previous) => ({ ...previous, ...fields }));
  }, []);

  return { draft, setDraft, patch, dirty, reset } as const;
}
