import { useState } from 'react';

import { Archive, ArchiveRestore, CalendarClock, Pencil, Pin, PinOff, Plus } from 'lucide-react';

import { useToast } from '@/app/providers';
import { Badge, Button, Drawer, Input, SearchInput, Select, Textarea } from '@/components/ui';
import { useDisclosure } from '@/hooks/useDisclosure';
import { cn } from '@/utils/cn';

import {
  ANNOUNCEMENT_PRIORITY_LABEL,
  ANNOUNCEMENT_PRIORITY_VARIANT,
  formatDate,
} from '../administration.meta';
import type { Announcement, AnnouncementPriority } from '../administration.types';
import { useAnnouncementMutations, useAnnouncements } from '../api/useAdministrationQueries';
import { AsyncSection, Overline } from '../components/primitives';
import { SectionShell, ToolbarGrow } from '../components/SectionShell';

/**
 * AnnouncementsSection — internal clinic notices (Phase 17).
 * Full lifecycle over the seeded notices: create, edit, pin, archive/restore,
 * priority and expiry. Mutations run against local state (the mock layer has
 * the clinic store, so they persist across navigation and reloads.
 */
interface FormState {
  title: string;
  body: string;
  priority: AnnouncementPriority;
  expiresAt: string;
}

const EMPTY_FORM: FormState = { title: '', body: '', priority: 'normal', expiresAt: '' };

const FILTER_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'pinned', label: 'Pinned' },
  { value: 'archived', label: 'Archived' },
  { value: 'all', label: 'All' },
] as const;

const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
] as const;

export function AnnouncementsSection() {
  const query = useAnnouncements();
  const { toast } = useToast();

  const { create, update } = useAnnouncementMutations();
  const items = query.data ?? [];
  const [filter, setFilter] = useState('active');
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const drawer = useDisclosure(false);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    drawer.open();
  };

  const openEdit = (item: Announcement) => {
    setEditingId(item.id);
    setForm({
      title: item.title,
      body: item.body,
      priority: item.priority,
      expiresAt: item.expiresAt ?? '',
    });
    drawer.open();
  };

  const submit = () => {
    const title = form.title.trim();
    if (!title) return;
    const body = form.body.trim();
    const expiresAt = form.expiresAt || undefined;

    // The drawer closes on success only: a failed write keeps what was
    // typed in front of the administrator instead of discarding it.
    const onError = () => toast({ variant: 'error', title: "Couldn't save the announcement" });

    if (editingId) {
      update.mutate(
        { id: editingId, changes: { title, body, priority: form.priority, expiresAt } },
        {
          onSuccess: () => {
            toast({ variant: 'success', title: 'Announcement updated' });
            drawer.close();
          },
          onError,
        },
      );
    } else {
      create.mutate(
        {
          title,
          body,
          author: 'Dr. Lena Hart',
          priority: form.priority,
          pinned: false,
          archived: false,
          createdAt: new Date().toISOString().slice(0, 10),
          expiresAt,
        },
        {
          onSuccess: () => {
            toast({ variant: 'success', title: 'Announcement posted' });
            drawer.close();
          },
          onError,
        },
      );
    }
  };

  const togglePin = (item: Announcement) => {
    update.mutate(
      { id: item.id, changes: { pinned: !item.pinned } },
      {
        onSuccess: () =>
          toast({ variant: 'info', title: item.pinned ? 'Unpinned' : 'Pinned to top' }),
        onError: () => toast({ variant: 'error', title: "Couldn't update " + item.title }),
      },
    );
  };

  const toggleArchive = (item: Announcement) => {
    update.mutate(
      { id: item.id, changes: { archived: !item.archived, pinned: false } },
      {
        onSuccess: () => toast({ variant: 'info', title: item.archived ? 'Restored' : 'Archived' }),
        onError: () => toast({ variant: 'error', title: "Couldn't update " + item.title }),
      },
    );
  };

  const visible = items
    .filter((a) => {
      if (filter === 'active' && a.archived) return false;
      if (filter === 'pinned' && !a.pinned) return false;
      if (filter === 'archived' && !a.archived) return false;
      const q = search.trim().toLowerCase();
      if (q && !`${a.title} ${a.body}`.toLowerCase().includes(q)) return false;
      return true;
    })
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt));

  return (
    <SectionShell
      slug="announcements"
      actions={
        <Button leadingIcon={Plus} onClick={openCreate}>
          New announcement
        </Button>
      }
      toolbar={
        <>
          <ToolbarGrow>
            <SearchInput
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onClear={() => setSearch('')}
              placeholder="Search announcements…"
              aria-label="Search announcements"
            />
          </ToolbarGrow>
          <Select
            options={FILTER_OPTIONS}
            value={filter}
            onChange={setFilter}
            aria-label="Filter announcements"
            containerClassName="sm:w-44"
          />
        </>
      }
    >
      <AsyncSection
        isLoading={query.isLoading}
        isError={query.isError}
        onRetry={() => void query.refetch()}
      >
        {visible.length === 0 ? (
          <p className="rounded-surface border border-dashed border-border px-4 py-10 text-center text-body-sm text-text-secondary">
            No announcements to show.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {visible.map((item) => (
              <li
                key={item.id}
                className={cn(
                  'flex flex-col gap-3 rounded-surface border bg-surface p-4',
                  item.pinned ? 'border-primary' : 'border-border',
                  item.archived && 'opacity-70',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-2">
                    {item.pinned ? (
                      <Pin
                        aria-hidden="true"
                        className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                        strokeWidth={2}
                      />
                    ) : null}
                    <h2 className="text-body font-semibold text-text-primary">{item.title}</h2>
                  </div>
                  <Badge variant={ANNOUNCEMENT_PRIORITY_VARIANT[item.priority]}>
                    {ANNOUNCEMENT_PRIORITY_LABEL[item.priority]}
                  </Badge>
                </div>

                <p className="text-body-sm text-text-secondary">{item.body}</p>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Overline>{item.author}</Overline>
                  <span className="text-caption text-text-tertiary">
                    Posted {formatDate(item.createdAt)}
                  </span>
                  {item.expiresAt ? (
                    <span className="inline-flex items-center gap-1 text-caption text-text-tertiary">
                      <CalendarClock aria-hidden="true" className="h-3 w-3" strokeWidth={1.75} />
                      Expires {formatDate(item.expiresAt)}
                    </span>
                  ) : null}
                </div>

                <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    leadingIcon={item.pinned ? PinOff : Pin}
                    onClick={() => togglePin(item)}
                    disabled={item.archived}
                  >
                    {item.pinned ? 'Unpin' : 'Pin'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    leadingIcon={Pencil}
                    onClick={() => openEdit(item)}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    leadingIcon={item.archived ? ArchiveRestore : Archive}
                    onClick={() => toggleArchive(item)}
                  >
                    {item.archived ? 'Restore' : 'Archive'}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </AsyncSection>

      <Drawer
        open={drawer.isOpen}
        onClose={drawer.close}
        title={editingId ? 'Edit announcement' : 'New announcement'}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={drawer.close}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={form.title.trim().length === 0}>
              {editingId ? 'Save changes' : 'Post'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Input
            label="Title"
            value={form.title}
            onChange={(event) => setForm((f) => ({ ...f, title: event.target.value }))}
            placeholder="Short, clear headline"
            required
          />
          <Textarea
            label="Message"
            value={form.body}
            onChange={(event) => setForm((f) => ({ ...f, body: event.target.value }))}
            placeholder="What does the team need to know?"
            rows={4}
          />
          <Select
            label="Priority"
            options={PRIORITY_OPTIONS}
            value={form.priority}
            onChange={(value) =>
              setForm((f) => ({ ...f, priority: value as AnnouncementPriority }))
            }
          />
          <Input
            label="Expiry (optional)"
            type="date"
            value={form.expiresAt}
            onChange={(event) => setForm((f) => ({ ...f, expiresAt: event.target.value }))}
          />
        </div>
      </Drawer>
    </SectionShell>
  );
}
