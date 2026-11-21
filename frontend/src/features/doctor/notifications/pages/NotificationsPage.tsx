import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  Archive,
  Bell,
  BellOff,
  MailCheck,
  MailOpen,
  RefreshCw,
  SearchX,
  Settings2,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';

import { useToast } from '@/app/providers';
import { EmptyState } from '@/components/feedback';
import { ContentHeader, PageContainer, PageSections, Stack } from '@/components/layout';
import { FilterBar, SearchBar } from '@/components/patterns';
import {
  Breadcrumb,
  Button,
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
import { NotificationSummaryCards } from '../components/NotificationSummaryCards';
import { useNotificationListState } from '../hooks/useNotificationListState';
import { notificationCapabilities } from '../model/capabilities';
import { toActiveFilterChips } from '../model/filters';
import type { NotificationPatch } from '../model/notification-service';
import {
  NOTIFICATION_SORTS,
  NOTIFICATION_SORT_LABELS,
  filterNotifications,
  isNotificationSort,
  sortNotifications,
  summarizeNotifications,
} from '../model/selectors';
import type { DoctorNotification } from '../model/types';

/**
 * Notifications & Communication Center — UX §1.3. Two tabs: the
 * notification inbox (URL-owned search/filters/sort/pagination, bulk
 * actions, detail drawer) and the communication center (colleague chats,
 * announcements, system alerts). Preferences persist per user in the demo
 * and are not offered live, where no route stores them; every
 * read-state mutation invalidates the shared badge query, so the navbar
 * bell and nav badges update everywhere at once.
 */
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

  const notifications = useMemo(() => listQuery.data ?? [], [listQuery.data]);
  const summary = useMemo(() => summarizeNotifications(notifications), [notifications]);
  const filtered = useMemo(
    () => filterNotifications(notifications, list.q, list.filters),
    [notifications, list.q, list.filters],
  );
  const sorted = useMemo(() => sortNotifications(filtered, list.sort), [filtered, list.sort]);
  const pageRows = useMemo(
    () => pageSlice(sorted, list.page, list.pageSize),
    [sorted, list.page, list.pageSize],
  );

  const detailNotification =
    detailId !== null
      ? (notifications.find((notification) => notification.id === detailId) ?? null)
      : null;

  const unreadMessages = (conversationsQuery.data ?? []).reduce(
    (sum, conversation) => sum + conversation.unreadCount,
    0,
  );

  // The list rolls itself back on a refused write (DP-05); this says so, so a
  // row that reappears is never a silent mystery.
  const patch = useCallback(
    (ids: readonly string[], value: NotificationPatch) =>
      updateMutation.mutate(
        { ids, patch: value },
        {
          onError: () =>
            toast({
              variant: 'error',
              title: `Could not update ${ids.length === 1 ? 'the notification' : `${String(ids.length)} notifications`}`,
              description: 'Nothing was changed.',
            }),
        },
      ),
    [updateMutation, toast],
  );

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
  const hasSearchOrFilters = list.q !== '' || list.hasActiveFilters;

  const emptyState = hasSearchOrFilters ? (
    <EmptyState
      icon={SearchX}
      title="No notifications match"
      description="Nothing matches the current search and filters."
      action={
        <Button
          variant="secondary"
          onClick={() => {
            setSearchInput('');
            list.setQuery('');
            list.clearFilters();
          }}
        >
          Clear search & filters
        </Button>
      }
    />
  ) : (
    <EmptyState
      icon={BellOff}
      tone="error"
      title="You're all caught up"
      description="New notifications appear here as clinical activity happens."
    />
  );

  const listError = listQuery.isError
    ? { title: "Couldn't load notifications", onRetry: () => void listQuery.refetch() }
    : undefined;

  const inboxTab = (
    <Stack gap={4}>
      <FilterBar
        filters={activeChips}
        onRemove={list.removeFilter}
        onClearAll={list.clearFilters}
        search={
          <SearchBar
            label="Search notifications"
            placeholder="Search title, message, sender, patient…"
            value={searchInput}
            onValueChange={setSearchInput}
            onDebouncedChange={list.setQuery}
            resultCount={listQuery.isPending ? null : filtered.length}
          />
        }
        actions={
          <>
            <div className="w-40">
              <Select
                aria-label="Sort notifications"
                options={NOTIFICATION_SORTS.map((sort) => ({
                  value: sort,
                  label: NOTIFICATION_SORT_LABELS[sort],
                }))}
                value={list.sort}
                onChange={(value) => {
                  if (isNotificationSort(value)) list.setSort(value);
                }}
              />
            </div>
            <Tooltip content="Refresh">
              <IconButton
                icon={RefreshCw}
                aria-label="Refresh notifications"
                loading={listQuery.isFetching && !listQuery.isPending}
                onClick={() => void listQuery.refetch()}
              />
            </Tooltip>
            <Button
              variant="secondary"
              leadingIcon={SlidersHorizontal}
              onClick={filtersDrawer.open}
              aria-expanded={filtersDrawer.isOpen}
            >
              Filters{activeChips.length > 0 ? ` (${String(activeChips.length)})` : ''}
            </Button>
          </>
        }
      />

      {selectedIds.length > 0 ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-surface border border-border bg-primary-subtle px-4 py-2"
        >
          <p className="text-body-sm font-medium text-primary">{selectedIds.length} selected</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              leadingIcon={MailOpen}
              onClick={() => {
                patch(selectedIds, { read: true });
                setSelectedIds([]);
              }}
            >
              Mark read
            </Button>
            <Button
              variant="ghost"
              size="sm"
              leadingIcon={MailCheck}
              onClick={() => {
                patch(selectedIds, { read: false });
                setSelectedIds([]);
              }}
            >
              Mark unread
            </Button>
            {notificationCapabilities.organize ? (
              <Button
                variant="ghost"
                size="sm"
                leadingIcon={Archive}
                onClick={() => {
                  patch(selectedIds, { archived: true });
                  setSelectedIds([]);
                }}
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
        </div>
      ) : null}

      <NotificationList
        notifications={pageRows}
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
    </Stack>
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
      <PageSections>
        <ContentHeader
          title="Notifications"
          caption="Clinical alerts, reminders, and team communication in one place."
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
                  leadingIcon={MailCheck}
                  onClick={() => setConfirmClearRead(true)}
                >
                  Clear read
                </Button>
              ) : null}
              {notificationCapabilities.preferences ? (
                <Button
                  variant="secondary"
                  leadingIcon={Settings2}
                  onClick={preferencesDrawer.open}
                >
                  Preferences
                </Button>
              ) : null}
            </>
          }
        />

        <NotificationSummaryCards summary={summary} loading={listQuery.isPending} />

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
        onClear={list.clearFilters}
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
            deleteMutation.mutate(confirmDelete);
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
