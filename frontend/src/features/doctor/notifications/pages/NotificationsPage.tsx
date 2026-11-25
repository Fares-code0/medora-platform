import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  Archive,
  Bell,
  BellOff,
  CheckCheck,
  Inbox,
  MailCheck,
  MailOpen,
  RefreshCw,
  SearchX,
  Settings2,
  SlidersHorizontal,
  Star,
  Trash2,
  X,
} from 'lucide-react';

import { useToast } from '@/app/providers';
import { EmptyState } from '@/components/feedback';
import { ContentHeader, PageContainer, PageSections } from '@/components/layout';
import { FilterBar, SearchBar } from '@/components/patterns';
import {
  Breadcrumb,
  Button,
  Checkbox,
  ConfirmationDialog,
  IconButton,
  Pagination,
  Select,
  Tabs,
  Tooltip,
  type TabItem,
} from '@/components/ui';
import { useDisclosure } from '@/hooks/useDisclosure';
import { useT, type MessageKey } from '@/i18n';
import { routes } from '@/routes';
import { pageSlice } from '@/utils/pagination';

import {
  useArchiveAllReadMutation,
  useConversationsQuery,
  useDeleteNotificationsMutation,
  useNotificationsListQuery,
  useUpdateNotificationsMutation,
} from '../api/useNotificationsQuery';
import { CommunicationCenter } from '../components/CommunicationCenter';
import { NotificationDetailDrawer } from '../components/NotificationDetailDrawer';
import { NotificationFiltersDrawer } from '../components/NotificationFiltersDrawer';
import { NotificationList } from '../components/NotificationList';
import { NotificationPreferencesDrawer } from '../components/NotificationPreferencesDrawer';
import { NotificationSummaryLine } from '../components/NotificationSummaryCards';
import { NotificationViewNav } from '../components/NotificationViewNav';
import { useNotificationListState } from '../hooks/useNotificationListState';
import { notificationCapabilities } from '../model/capabilities';
import { toActiveFilterChips } from '../model/filters';
import type { NotificationPatch } from '../model/notification-service';
import {
  NOTIFICATION_SORTS,
  NOTIFICATION_SORT_LABELS,
  countNotificationViews,
  filterNotifications,
  groupNotifications,
  isNotificationSort,
  sortNotifications,
  summarizeNotifications,
} from '../model/selectors';
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_META,
  NOTIFICATION_STATUS_FILTERS,
  isNotificationCategory,
  type DoctorNotification,
  type NotificationStatusFilter,
} from '../model/types';

/**
 * Notifications & Communication Center — UX §1.3. Two tabs: the
 * notification inbox and the communication center (colleague chats,
 * announcements, system alerts).
 *
 * The inbox is laid out like a mail client: a compact header with the
 * unread count, the views (Inbox, Unread, Read, Starred, Archived — the
 * `?status=` param, so older links still land on the same list) beside the
 * list on large screens and above it as scrolling chips on small ones, one
 * toolbar (search, category, sort, the Filters drawer for the rest), and
 * dense rows grouped by day for the date sorts. Search, filters, sort and
 * pagination run over the whole list the service returns, not one page of
 * it. Every read-state mutation reconciles the shared badge query, so the
 * navbar bell and nav badges update everywhere at once.
 */

const ALL_CATEGORIES = 'all';

/** Starred and Archived exist only where the service keeps those flags. */
const VIEWS: readonly NotificationStatusFilter[] = notificationCapabilities.organize
  ? NOTIFICATION_STATUS_FILTERS
  : NOTIFICATION_STATUS_FILTERS.filter((view) => view !== 'starred' && view !== 'archived');

const plural = (count: number, one: string, many = `${one}s`) =>
  `${String(count)} ${count === 1 ? one : many}`;

/** What a bulk patch did, for its toast: "3 notifications marked as read". */
function bulkVerb(patch: NotificationPatch): string {
  if (patch.read === true) return 'marked as read';
  if (patch.read === false) return 'marked as unread';
  if (patch.archived === true) return 'archived';
  if (patch.archived === false) return 'moved to the inbox';
  if (patch.favorite === true) return 'starred';
  if (patch.favorite === false) return 'unstarred';
  if (patch.pinned === true) return 'pinned';
  return 'unpinned';
}

const VIEW_EMPTY: Record<
  NotificationStatusFilter,
  { readonly title: MessageKey; readonly description: MessageKey }
> = {
  active: {
    title: 'notifications.empty.active.title',
    description: 'notifications.empty.active.body',
  },
  unread: {
    title: 'notifications.empty.unread.title',
    description: 'notifications.empty.unread.body',
  },
  read: {
    title: 'notifications.empty.read.title',
    description: 'notifications.empty.read.body',
  },
  starred: {
    title: 'notifications.empty.starred.title',
    description: 'notifications.empty.starred.body',
  },
  archived: {
    title: 'notifications.empty.archived.title',
    description: 'notifications.empty.archived.body',
  },
};

export function NotificationsPage() {
  const t = useT();
  const { toast } = useToast();
  const list = useNotificationListState();
  const filtersDrawer = useDisclosure();
  const preferencesDrawer = useDisclosure();

  const listQuery = useNotificationsListQuery();
  const conversationsQuery = useConversationsQuery();
  const updateMutation = useUpdateNotificationsMutation();
  const deleteMutation = useDeleteNotificationsMutation();
  const archiveReadMutation = useArchiveAllReadMutation();

  const [searchInput, setSearchInput] = useState(list.q);
  useEffect(() => setSearchInput(list.q), [list.q]);

  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<readonly string[] | null>(null);
  const [confirmClearRead, setConfirmClearRead] = useState(false);

  // A selection is of rows on screen: changing what is on screen drops it,
  // so a bulk action can never reach rows the doctor can no longer see.
  useEffect(() => {
    setSelectedIds([]);
  }, [list.filters, list.q, list.sort, list.page, list.pageSize]);

  const notifications = useMemo(() => listQuery.data ?? [], [listQuery.data]);
  const summary = useMemo(() => summarizeNotifications(notifications), [notifications]);
  const viewCounts = useMemo(() => countNotificationViews(notifications), [notifications]);
  const filtered = useMemo(
    () => filterNotifications(notifications, list.q, list.filters),
    [notifications, list.q, list.filters],
  );
  const sorted = useMemo(() => sortNotifications(filtered, list.sort), [filtered, list.sort]);
  const pageRows = useMemo(
    () => pageSlice(sorted, list.page, list.pageSize),
    [sorted, list.page, list.pageSize],
  );
  // Groups the visible page only: pagination counts stay those of `sorted`.
  const groups = useMemo(() => groupNotifications(pageRows, list.sort), [pageRows, list.sort]);

  const detailNotification =
    detailId !== null
      ? (notifications.find((notification) => notification.id === detailId) ?? null)
      : null;

  const unreadMessages = (conversationsQuery.data ?? []).reduce(
    (sum, conversation) => sum + conversation.unreadCount,
    0,
  );

  // The list rolls itself back on a refused write (DP-05); this says so, so a
  // row that reappears is never a silent mystery. A bulk action also says
  // when it worked — and only then.
  //
  // `mutateAsync`, not `mutate(vars, { onSuccess })`: TanStack Query runs a
  // `mutate` call's own callbacks only for the LATEST call on the observer,
  // so a second bulk action started before the first settled swallowed the
  // first one's toast. Each call's promise reports its own outcome.
  const { mutateAsync: updateNotifications } = updateMutation;
  const patch = useCallback(
    (ids: readonly string[], value: NotificationPatch, options?: { readonly bulk?: boolean }) => {
      updateNotifications({ ids, patch: value }).then(
        () => {
          if (options?.bulk) {
            toast({
              variant: 'success',
              title: `${plural(ids.length, 'notification')} ${bulkVerb(value)}`,
            });
          }
        },
        () =>
          toast({
            variant: 'error',
            title: t('notifications.toast.updateFailed', { count: ids.length }),
            // One write per row: a bulk failure may have landed part-way,
            // and the reconcile shows exactly what was kept.
            description:
              ids.length === 1
                ? t('notifications.toast.updateFailedOne')
                : t('notifications.toast.updateFailedMany'),
          }),
      );
    },
    [updateNotifications, toast, t],
  );

  const bulkPatch = (value: NotificationPatch) => {
    patch(selectedIds, value, { bulk: true });
    setSelectedIds([]);
  };

  const openNotification = useCallback(
    (notification: DoctorNotification) => {
      setDetailId(notification.id);
      if (!notification.read) patch([notification.id], { read: true });
    },
    [patch],
  );

  const requestDelete = useCallback(
    (notification: DoctorNotification) => setConfirmDelete([notification.id]),
    [],
  );

  const activeChips = toActiveFilterChips(list.filters);
  const view = list.filters.status;
  const isNarrowed = list.q !== '' || list.facetCount > 0;
  const drawerFacetCount = activeChips.filter((chip) => chip.id !== 'category').length;

  const clearSearchAndFilters = () => {
    setSearchInput('');
    list.clearFacets({ query: true });
  };

  const emptyState = isNarrowed ? (
    <EmptyState
      icon={SearchX}
      title={t('notifications.empty.noMatch.title')}
      description={t('notifications.empty.noMatch.body')}
      action={
        <Button variant="secondary" onClick={clearSearchAndFilters}>
          {t('notifications.clearFilters')}
        </Button>
      }
    />
  ) : view === 'active' && notifications.length === 0 ? (
    <EmptyState
      icon={BellOff}
      tone="error"
      title={t('notifications.empty.none.title')}
      description={t('notifications.empty.none.body')}
    />
  ) : (
    <EmptyState
      icon={view === 'unread' ? CheckCheck : view === 'starred' ? Star : Inbox}
      tone={view === 'unread' ? 'success' : 'neutral'}
      title={t(VIEW_EMPTY[view].title)}
      description={t(VIEW_EMPTY[view].description)}
    />
  );

  const listError = listQuery.isError
    ? { title: t('notifications.error.load'), onRetry: () => void listQuery.refetch() }
    : undefined;

  const showRows = !listQuery.isPending && !listQuery.isError && pageRows.length > 0;
  const visibleIds = pageRows.map((notification) => notification.id);
  const selectedVisible = visibleIds.filter((id) => selectedIds.includes(id)).length;
  const allVisibleSelected = showRows && selectedVisible === visibleIds.length;
  const firstRow = (list.page - 1) * list.pageSize + 1;
  const lastRow = firstRow + pageRows.length - 1;

  const toolbar = (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-full min-w-0 sm:w-auto sm:min-w-[14rem] sm:flex-1">
          <SearchBar
            label={t('notifications.search.label')}
            placeholder={t('notifications.search.placeholder')}
            value={searchInput}
            onValueChange={setSearchInput}
            onDebouncedChange={list.setQuery}
            resultCount={listQuery.isPending ? null : filtered.length}
          />
        </div>
        {/* On phones the two selects share a row at no less than 8.5rem each
            and the actions wrap below them: with `min-w-0` alone, a 320px
            screen squeezed them to "A…" and "N…" (seen in a real browser). */}
        <Select
          aria-label={t('notifications.filter.category')}
          containerClassName="min-w-[8.5rem] flex-1 basis-[8.5rem] sm:w-44 sm:flex-none sm:basis-auto"
          options={[
            { value: ALL_CATEGORIES, label: 'All categories' },
            ...NOTIFICATION_CATEGORIES.map((category) => ({
              value: category,
              label: NOTIFICATION_CATEGORY_META[category].label,
            })),
          ]}
          value={list.filters.category ?? ALL_CATEGORIES}
          onChange={(value) =>
            list.setFilter('category', isNotificationCategory(value) ? value : null)
          }
        />
        <Select
          aria-label={t('notifications.sort.label')}
          containerClassName="min-w-[8.5rem] flex-1 basis-[8.5rem] sm:w-40 sm:flex-none sm:basis-auto"
          options={NOTIFICATION_SORTS.map((sort) => ({
            value: sort,
            label: NOTIFICATION_SORT_LABELS[sort],
          }))}
          value={list.sort}
          onChange={(value) => {
            if (isNotificationSort(value)) list.setSort(value);
          }}
        />
        {/* Wraps on a phone: with Clear read and Preferences in this group it
            can outgrow a 320px row. */}
        <div className="flex flex-wrap items-center gap-1">
          <Button
            variant="secondary"
            size="sm"
            leadingIcon={SlidersHorizontal}
            onClick={filtersDrawer.open}
            aria-expanded={filtersDrawer.isOpen}
          >
            {drawerFacetCount > 0
              ? t('notifications.filtersCount', { count: drawerFacetCount })
              : t('notifications.filters')}
          </Button>
          <Tooltip content={t('notifications.refresh')}>
            <IconButton
              icon={RefreshCw}
              size="sm"
              aria-label={t('notifications.refreshLabel')}
              loading={listQuery.isFetching && !listQuery.isPending}
              onClick={() => void listQuery.refetch()}
            />
          </Tooltip>
          {isNarrowed ? (
            <Button variant="ghost" size="sm" leadingIcon={X} onClick={clearSearchAndFilters}>
              {t('notifications.clearFilters')}
            </Button>
          ) : null}
          {/* Inbox-level actions: they act on the inbox, so they sit with the
              inbox's own controls (and only on the Notifications tab). */}
          {notificationCapabilities.clearRead ? (
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={MailCheck}
              onClick={() => setConfirmClearRead(true)}
            >
              {t('notifications.clearRead')}
            </Button>
          ) : null}
          {notificationCapabilities.preferences ? (
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={Settings2}
              onClick={preferencesDrawer.open}
            >
              {t('notifications.preferences')}
            </Button>
          ) : null}
        </div>
      </div>
      {activeChips.length > 0 ? (
        <FilterBar
          filters={activeChips}
          onRemove={list.removeFilter}
          onClearAll={() => list.clearFacets()}
        />
      ) : null}
    </div>
  );

  const selectionBar = showRows ? (
    <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 rounded-surface border border-border bg-surface px-3 py-1.5">
      <Checkbox
        aria-label={t('notifications.selectAll')}
        checked={allVisibleSelected}
        indeterminate={selectedVisible > 0 && !allVisibleSelected}
        onChange={(event) => setSelectedIds(event.target.checked ? visibleIds : [])}
      />
      {selectedIds.length > 0 ? (
        <>
          <p role="status" className="text-body-sm font-medium text-primary">
            {selectedIds.length} selected
          </p>
          <div className="flex flex-wrap items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              leadingIcon={MailOpen}
              onClick={() => bulkPatch({ read: true })}
            >
              {t('notifications.bulk.markRead')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              leadingIcon={MailCheck}
              onClick={() => bulkPatch({ read: false })}
            >
              {t('notifications.bulk.markUnread')}
            </Button>
            {notificationCapabilities.organize ? (
              <Button
                variant="ghost"
                size="sm"
                leadingIcon={Archive}
                onClick={() => bulkPatch({ archived: true })}
              >
                {t('notifications.bulk.archive')}
              </Button>
            ) : null}
            {notificationCapabilities.remove ? (
              <Button
                variant="ghost"
                size="sm"
                leadingIcon={Trash2}
                onClick={() => setConfirmDelete(selectedIds)}
              >
                {t('notifications.bulk.delete')}
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" onClick={() => setSelectedIds([])}>
              {t('notifications.bulk.clearSelection')}
            </Button>
          </div>
        </>
      ) : (
        <p className="text-caption tabular-nums text-text-secondary">
          {firstRow === lastRow
            ? t('notifications.range.one', { first: firstRow, total: sorted.length })
            : t('notifications.range.many', {
                first: firstRow,
                last: lastRow,
                total: sorted.length,
              })}
        </p>
      )}
    </div>
  ) : null;

  const inboxTab = (
    <div className="grid gap-3 lg:grid-cols-[12.5rem_minmax(0,1fr)] lg:gap-5">
      <div className="min-w-0 lg:sticky lg:top-4 lg:self-start">
        <NotificationViewNav
          value={view}
          counts={listQuery.isPending ? null : viewCounts}
          onChange={list.setView}
          views={VIEWS}
        />
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        {toolbar}
        {selectionBar}

        <NotificationList
          notifications={pageRows}
          groups={groups}
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
          onOpen={openNotification}
          onPatch={patch}
          onDelete={requestDelete}
          loading={listQuery.isPending}
          error={listError}
          emptyState={emptyState}
        />

        {!listQuery.isPending && !listQuery.isError && sorted.length > 0 ? (
          <Pagination
            page={list.page}
            pageSize={list.pageSize}
            totalItems={sorted.length}
            onPageChange={list.setPage}
            onPageSizeChange={list.setPageSize}
          />
        ) : null}
      </div>
    </div>
  );

  const tabs: readonly TabItem[] = [
    { value: 'inbox', label: t('nav.notifications'), count: summary.unread, content: inboxTab },
    {
      value: 'messages',
      label: t('nav.messages'),
      count: unreadMessages,
      content: (
        <CommunicationCenter
          conversationId={list.conversationId}
          onOpenConversation={list.setConversation}
        />
      ),
    },
  ];

  return (
    <PageContainer width="2xl">
      <PageSections gap={3}>
        <ContentHeader
          title={t('nav.notifications')}
          icon={Bell}
          tone="error"
          breadcrumb={
            <Breadcrumb
              items={[
                { label: t('nav.overview'), href: routes.doctor.overview },
                { label: t('nav.notifications') },
              ]}
            />
          }
        />

        <NotificationSummaryLine summary={summary} loading={listQuery.isPending} />

        <Tabs
          aria-label={t('notifications.tabsLabel')}
          items={tabs}
          value={list.tab}
          onValueChange={list.setTab}
        />
      </PageSections>

      <NotificationFiltersDrawer
        open={filtersDrawer.isOpen}
        onClose={filtersDrawer.close}
        filters={list.filters}
        onFilterChange={list.setFilter}
        onClear={() => list.clearFacets()}
      />

      <NotificationPreferencesDrawer
        open={preferencesDrawer.isOpen}
        onClose={preferencesDrawer.close}
      />

      <NotificationDetailDrawer
        notification={detailNotification}
        onClose={() => setDetailId(null)}
        onPatch={patch}
        onDelete={(notification) => setConfirmDelete([notification.id])}
      />

      <ConfirmationDialog
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete) {
            const count = confirmDelete.length;
            deleteMutation.mutate(confirmDelete, {
              onSuccess: () =>
                toast({ variant: 'success', title: `${plural(count, 'notification')} deleted` }),
              onError: () =>
                toast({
                  variant: 'error',
                  title: `Could not delete ${count === 1 ? 'the notification' : plural(count, 'notification')}`,
                  description: 'The list shows what was kept.',
                }),
            });
            setSelectedIds([]);
            if (detailId !== null && confirmDelete.includes(detailId)) setDetailId(null);
          }
          setConfirmDelete(null);
        }}
        title={t('notifications.delete.title', { count: confirmDelete?.length ?? 0 })}
        description={t('notifications.delete.body')}
        confirmLabel={t('notifications.bulk.delete')}
        tone="destructive"
      />

      <ConfirmationDialog
        open={confirmClearRead}
        onClose={() => setConfirmClearRead(false)}
        onConfirm={() => {
          archiveReadMutation.mutate(undefined, {
            onSuccess: (count) =>
              toast({
                variant: 'success',
                title: `${String(count)} read notification${count === 1 ? '' : 's'} archived`,
              }),
            onError: () =>
              toast({
                variant: 'error',
                title: 'Could not archive read notifications',
                description: 'Nothing was moved.',
              }),
          });
          setConfirmClearRead(false);
        }}
        title={t('notifications.clearRead.title')}
        description={t('notifications.clearRead.body')}
        confirmLabel={t('notifications.clearRead.confirm')}
        tone="primary"
      />
    </PageContainer>
  );
}
