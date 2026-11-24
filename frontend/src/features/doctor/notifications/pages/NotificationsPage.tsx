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
  { readonly title: string; readonly description: string }
> = {
  active: {
    title: 'Your inbox is clear',
    description: 'Nothing is waiting here. Archived notifications are under Archived.',
  },
  unread: {
    title: "You're all caught up",
    description: 'Every notification has been read.',
  },
  read: {
    title: 'No read notifications',
    description: 'Notifications you have opened or marked as read appear here.',
  },
  starred: {
    title: 'No starred notifications',
    description: 'Star a notification from its actions menu to keep it here.',
  },
  archived: {
    title: 'Nothing archived',
    description: 'Archived notifications leave the inbox and are kept here.',
  },
};

export function NotificationsPage() {
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
            title: `Could not update ${ids.length === 1 ? 'the notification' : `${String(ids.length)} notifications`}`,
            // One write per row: a bulk failure may have landed part-way,
            // and the reconcile shows exactly what was kept.
            description:
              ids.length === 1
                ? 'Nothing was changed.'
                : 'Some or all of them were not changed. The list shows what was saved.',
          }),
      );
    },
    [updateNotifications, toast],
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
      title="No notifications match"
      description="Nothing in this view matches the current search and filters."
      action={
        <Button variant="secondary" onClick={clearSearchAndFilters}>
          Clear filters
        </Button>
      }
    />
  ) : view === 'active' && notifications.length === 0 ? (
    <EmptyState
      icon={BellOff}
      tone="error"
      title="No notifications yet"
      description="New notifications appear here as clinical activity happens."
    />
  ) : (
    <EmptyState
      icon={view === 'unread' ? CheckCheck : view === 'starred' ? Star : Inbox}
      tone={view === 'unread' ? 'success' : 'neutral'}
      title={VIEW_EMPTY[view].title}
      description={VIEW_EMPTY[view].description}
    />
  );

  const listError = listQuery.isError
    ? { title: "Couldn't load notifications", onRetry: () => void listQuery.refetch() }
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
            label="Search notifications"
            placeholder="Search title, message, sender…"
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
          aria-label="Filter by category"
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
          aria-label="Sort notifications"
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
        <div className="flex items-center gap-1">
          <Button
            variant="secondary"
            size="sm"
            leadingIcon={SlidersHorizontal}
            onClick={filtersDrawer.open}
            aria-expanded={filtersDrawer.isOpen}
          >
            Filters{drawerFacetCount > 0 ? ` (${String(drawerFacetCount)})` : ''}
          </Button>
          <Tooltip content="Refresh">
            <IconButton
              icon={RefreshCw}
              size="sm"
              aria-label="Refresh notifications"
              loading={listQuery.isFetching && !listQuery.isPending}
              onClick={() => void listQuery.refetch()}
            />
          </Tooltip>
          {isNarrowed ? (
            <Button variant="ghost" size="sm" leadingIcon={X} onClick={clearSearchAndFilters}>
              Clear filters
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
        aria-label="Select all notifications on this page"
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
              Mark read
            </Button>
            <Button
              variant="ghost"
              size="sm"
              leadingIcon={MailCheck}
              onClick={() => bulkPatch({ read: false })}
            >
              Mark unread
            </Button>
            {notificationCapabilities.organize ? (
              <Button
                variant="ghost"
                size="sm"
                leadingIcon={Archive}
                onClick={() => bulkPatch({ archived: true })}
              >
                Archive
              </Button>
            ) : null}
            {notificationCapabilities.remove ? (
              <Button
                variant="ghost"
                size="sm"
                leadingIcon={Trash2}
                onClick={() => setConfirmDelete(selectedIds)}
              >
                Delete
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" onClick={() => setSelectedIds([])}>
              Clear selection
            </Button>
          </div>
        </>
      ) : (
        <p className="text-caption tabular-nums text-text-secondary">
          {firstRow === lastRow
            ? `${String(firstRow)} of ${String(sorted.length)}`
            : `${String(firstRow)}–${String(lastRow)} of ${String(sorted.length)}`}
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
    { value: 'inbox', label: 'Notifications', count: summary.unread, content: inboxTab },
    {
      value: 'messages',
      label: 'Messages',
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
          title="Notifications"
          caption="Clinical alerts, reminders and team updates."
          icon={Bell}
          tone="error"
          breadcrumb={
            <Breadcrumb
              items={[
                { label: 'Overview', href: routes.doctor.overview },
                { label: 'Notifications' },
              ]}
            />
          }
          actions={
            <>
              {notificationCapabilities.clearRead ? (
                <Button
                  variant="secondary"
                  size="sm"
                  leadingIcon={MailCheck}
                  onClick={() => setConfirmClearRead(true)}
                >
                  Clear read
                </Button>
              ) : null}
              {notificationCapabilities.preferences ? (
                <Button
                  variant="secondary"
                  size="sm"
                  leadingIcon={Settings2}
                  onClick={preferencesDrawer.open}
                >
                  Preferences
                </Button>
              ) : null}
            </>
          }
        />

        <NotificationSummaryLine summary={summary} loading={listQuery.isPending} />

        <Tabs
          aria-label="Notifications and messages"
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
        title={`Delete ${String(confirmDelete?.length ?? 0)} notification${
          (confirmDelete?.length ?? 0) === 1 ? '' : 's'
        }?`}
        description="Deleted notifications cannot be recovered on this device."
        confirmLabel="Delete"
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
        title="Archive all read notifications?"
        description="Read notifications move to the Archived view; nothing is deleted."
        confirmLabel="Archive read"
        tone="primary"
      />
    </PageContainer>
  );
}
