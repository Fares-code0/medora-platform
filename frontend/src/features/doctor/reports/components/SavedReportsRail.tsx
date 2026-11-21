import { useState } from 'react';

import { BookmarkPlus, EllipsisVertical, Star } from 'lucide-react';

import { useToast } from '@/app/providers';
import { Button, Dropdown, IconButton, Input, Modal, type MenuEntry } from '@/components/ui';

import {
  useCreateSavedReportMutation,
  useDeleteSavedReportMutation,
  useDuplicateSavedReportMutation,
  useRenameSavedReportMutation,
  useToggleFavoriteMutation,
} from '../api/useReportsQueries';
import { REPORT_CATEGORIES, type ReportFilters, type SavedReport } from '../model/types';
import { reportsService } from '../service';

/**
 * Saved reports rail — favorite/recent lists with full CRUD: save the
 * current view, rename, duplicate, favorite, and delete. Applying a saved
 * report restores its exact filters (the page owns navigation). Bounded to a
 * small demo-friendly count by the service.
 *
 * Over the API there is no rename or favourite route, so neither is offered
 * (`reportsService.capabilities`); every write that fails says so, rather
 * than leaving the rail looking as if it had worked.
 */

function categoryLabel(report: SavedReport): string {
  return REPORT_CATEGORIES.find((c) => c.id === report.category)?.label ?? report.category;
}

export interface SavedReportsRailProps {
  saved: readonly SavedReport[];
  currentFilters: ReportFilters;
  onApply: (report: SavedReport) => void;
}

export function SavedReportsRail({ saved, currentFilters, onApply }: SavedReportsRailProps) {
  const { toast } = useToast();
  const createMutation = useCreateSavedReportMutation();
  const renameMutation = useRenameSavedReportMutation();
  const duplicateMutation = useDuplicateSavedReportMutation();
  const deleteMutation = useDeleteSavedReportMutation();
  const favoriteMutation = useToggleFavoriteMutation();

  const [dialog, setDialog] = useState<{ mode: 'create' | 'rename'; id?: string } | null>(null);
  const [name, setName] = useState('');

  const openCreate = () => {
    setName('');
    setDialog({ mode: 'create' });
  };
  const openRename = (report: SavedReport) => {
    setName(report.name);
    setDialog({ mode: 'rename', id: report.id });
  };

  const failed = (title: string) => () =>
    toast({ variant: 'error', title, description: 'Nothing was changed. Please try again.' });

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (dialog?.mode === 'create') {
      createMutation.mutate(
        { name: trimmed, filters: currentFilters },
        {
          onSuccess: () => toast({ variant: 'success', title: 'Report saved' }),
          onError: failed('Could not save the report'),
        },
      );
    } else if (dialog?.mode === 'rename' && dialog.id) {
      renameMutation.mutate(
        { id: dialog.id, name: trimmed },
        { onError: failed('Could not rename the report') },
      );
    }
    setDialog(null);
  };

  const { favorites: canFavorite, renameSaved: canRename } = reportsService.capabilities;

  const favorites = saved.filter((report) => report.favorite);
  const recent = [...saved].sort((a, b) => b.lastViewedAt.localeCompare(a.lastViewedAt));

  const menuFor = (report: SavedReport): readonly MenuEntry[] => [
    ...(canFavorite
      ? [
          {
            id: 'fav',
            label: report.favorite ? 'Remove favorite' : 'Add to favorites',
            icon: Star,
            onSelect: () =>
              favoriteMutation.mutate(report.id, {
                onError: failed('Could not update favorites'),
              }),
          },
        ]
      : []),
    ...(canRename ? [{ id: 'rename', label: 'Rename', onSelect: () => openRename(report) }] : []),
    {
      id: 'duplicate',
      label: 'Duplicate',
      onSelect: () =>
        duplicateMutation.mutate(report.id, {
          onSuccess: () => toast({ variant: 'success', title: 'Report duplicated' }),
          onError: failed('Could not duplicate the report'),
        }),
    },
    { id: 'sep', type: 'separator' },
    {
      id: 'delete',
      label: 'Delete',
      destructive: true,
      onSelect: () =>
        deleteMutation.mutate(report.id, {
          onSuccess: () => toast({ variant: 'success', title: 'Report deleted' }),
          onError: failed('Could not delete the report'),
        }),
    },
  ];

  const Row = ({ report }: { report: SavedReport }) => (
    <li className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => onApply(report)}
        className="min-w-0 flex-1 rounded-surface px-2 py-1.5 text-start transition-colors duration-fast hover:bg-surface-sunken"
      >
        <span className="flex items-center gap-1.5">
          {report.favorite ? (
            <Star className="h-3 w-3 shrink-0 fill-warning text-warning" aria-hidden="true" />
          ) : null}
          <span className="truncate text-body-sm font-medium text-text-primary">{report.name}</span>
        </span>
        <span className="block truncate text-caption text-text-tertiary">
          {categoryLabel(report)}
        </span>
      </button>
      <Dropdown
        trigger={
          <IconButton icon={EllipsisVertical} aria-label={`${report.name} options`} size="sm" />
        }
        entries={menuFor(report)}
        menuLabel={`${report.name} options`}
      />
    </li>
  );

  return (
    <div className="rounded-surface border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-h5 font-semibold text-text-primary">Saved reports</h3>
        <Button variant="ghost" size="sm" leadingIcon={BookmarkPlus} onClick={openCreate}>
          Save view
        </Button>
      </div>

      {saved.length === 0 ? (
        <p className="text-body-sm text-text-secondary">
          No saved reports yet. Save the current view to find it here.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {favorites.length > 0 ? (
            <div>
              <p className="mb-1 px-2 text-caption font-semibold uppercase tracking-wider text-text-tertiary">
                Favorites
              </p>
              <ul className="flex flex-col">
                {favorites.map((report) => (
                  <Row key={report.id} report={report} />
                ))}
              </ul>
            </div>
          ) : null}
          <div>
            <p className="mb-1 px-2 text-caption font-semibold uppercase tracking-wider text-text-tertiary">
              Recent
            </p>
            <ul className="flex flex-col">
              {recent.map((report) => (
                <Row key={report.id} report={report} />
              ))}
            </ul>
          </div>
        </div>
      )}

      <Modal
        open={dialog !== null}
        onClose={() => setDialog(null)}
        title={dialog?.mode === 'rename' ? 'Rename report' : 'Save this view'}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={name.trim() === ''}>
              {dialog?.mode === 'rename' ? 'Rename' : 'Save'}
            </Button>
          </>
        }
      >
        <Input
          label="Report name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Monthly executive summary"
          autoFocus
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submit();
            }
          }}
        />
      </Modal>
    </div>
  );
}
