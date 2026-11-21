import type { ReactNode } from 'react';

import { PagedList } from '@/components';
import { useT, type MessageKey } from '@/i18n';

import type { DoctorSearchQuery } from '../hooks';

import { DoctorCard } from './DoctorCard';

/**
 * A paged list of doctors, with its four states and its "Show more".
 *
 * ── It is the screen's scroll container ─────────────────────────────
 *
 * `PagedList` rather than a block inside `Screen`: the results list is
 * one of the three that grow without bound (`docs/PERF.md` §3), so it
 * owns the scroll and everything above it travels as `header`. Both
 * callers pass their own heading, which is why this component has no
 * title of its own.
 *
 * ── Why this was extracted, and what it is not ───────────────────────
 *
 * `DiscoverScreen` grew this block for G-02 and `DepartmentScreen`
 * (H-05) needs the same one: the same boundary, the same cards, the same
 * button, and the same three paging decisions that are easy to get
 * wrong and were argued out once already. Copying it would put those
 * decisions in two files, and the second copy is where infinite scroll
 * quietly comes back.
 *
 * It is not a general "list" abstraction. It takes a
 * `DoctorSearchQuery` — the shape `useDoctorSearch` returns — and it
 * renders `DoctorCard`, which is the G-03 projection allow-list. A
 * caller that wants something else wants a different component.
 *
 * ── The three decisions it carries ───────────────────────────────────
 *
 * 1. **A button, not scroll-triggered loading.** Infinite scroll takes
 *    the end of the list away from a screen-reader and keyboard user —
 *    there is no gesture to reach a footer that only appears after the
 *    fetch it triggers — and it spends a patient's data without them
 *    asking.
 * 2. **The loading state for page two lives BELOW the results.** If
 *    paging re-entered `AsyncBoundary`'s pending state, the list a
 *    patient is reading would be replaced by a skeleton.
 * 3. **"That is all of them" is said once, at the end, and only after
 *    paging.** On a short list it is noise; after a "Show more" it is
 *    the answer to "is that all?".
 */
export interface DoctorResultsProps {
  readonly query: DoctorSearchQuery;
  /** `<prefix>-doctors`, `<prefix>-load-more`, and so on. */
  readonly testIDPrefix: string;
  readonly onOpen: (doctorId: string) => void;
  readonly emptyTitleKey: MessageKey;
  readonly emptyBodyKey: MessageKey;
  /** The scroll container's test ID — the screen's, not the list's. */
  readonly screenTestID: string;
  /** Everything the screen renders above the results. */
  readonly header?: ReactNode;
}

export function DoctorResults({
  query,
  testIDPrefix,
  onOpen,
  emptyTitleKey,
  emptyBodyKey,
  screenTestID,
  header,
}: DoctorResultsProps) {
  const t = useT();

  return (
    <PagedList
      testID={screenTestID}
      statesTestID={`${testIDPrefix}-doctors`}
      query={query}
      {...(header === undefined ? {} : { header })}
      renderItem={(doctor) => (
        <DoctorCard
          testID={`doctor-card-${doctor.id}`}
          doctor={doctor}
          onPress={() => onOpen(doctor.id)}
        />
      )}
      empty={{ icon: 'search', title: t(emptyTitleKey), body: t(emptyBodyKey) }}
      paging={{
        testIDPrefix,
        statusTestIDPrefix: `${testIDPrefix}-doctors`,
        loadMoreLabel: t('discover.loadMore'),
        loadMoreHint: t('discover.loadMore.hint', {
          shown: query.data?.items.length ?? 0,
          total: query.data?.totalItems ?? 0,
        }),
        endLabel: t('discover.end', { total: query.data?.totalItems ?? 0 }),
      }}
    />
  );
}
