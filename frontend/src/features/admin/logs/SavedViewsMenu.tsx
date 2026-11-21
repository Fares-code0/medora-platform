import { useId, useRef, useState } from 'react';

import { Bookmark, Trash2 } from 'lucide-react';
import { createPortal } from 'react-dom';

import { useToast } from '@/app/providers';
import { Button, IconButton, Input, useFloating } from '@/components/ui';
import { useOutsideClick } from '@/hooks/useOutsideClick';

import { useLogMutations, useSavedViews } from './api/useLogsQueries';
import { activeFilterCount } from './logs';
import type { LogFilters } from './logs.types';

/**
 * Saved views (ADM-07 · UX §3.7) — the searches an investigation starts from.
 *
 * A bespoke popover rather than the design-system `Dropdown`: a `MenuList`
 * entry is one label and one action, and every row here is two — apply the
 * view, or delete it — plus a name field that has to live inside the same
 * surface as the list it adds to. A menu cannot express either.
 *
 * Applying a view hands the page the *whole* filter object rather than
 * patching fields into the current one. A view is a search someone saved,
 * not a modifier: merging it into whatever was already set would produce a
 * result matching neither, and an investigator comparing today's log against
 * last week's would be comparing two different questions.
 */

export interface SavedViewsMenuProps {
  /** The filters a new view would capture — the bar's current state. */
  filters: LogFilters;
  /** Receives a view's whole filter object; the page resets its page number. */
  onApply: (next: LogFilters) => void;
}

export function SavedViewsMenu({ filters, onApply }: SavedViewsMenuProps) {
  const views = useSavedViews();
  const { createView, deleteView } = useLogMutations();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  /** The name being typed, or `null` while the form is closed. */
  const [draftName, setDraftName] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const panelId = useId();

  // The panel is portaled and opens up or down by available space (useFloating).
  const floating = useFloating<HTMLDivElement>(open, wrapperRef, { align: 'end', cap: 480 });
  useOutsideClick([wrapperRef, floating.floatingRef], () => setOpen(false), open);

  const saved = views.data ?? [];
  const active = activeFilterCount(filters);
  const trimmed = draftName?.trim() ?? '';

  const save = () => {
    if (trimmed === '') return;
    createView.mutate(
      { name: trimmed, filters },
      {
        onSuccess: () => {
          // The panel stays open: the point of saving is seeing the view join
          // the list you will pick it from next time.
          setDraftName(null);
          toast({
            variant: 'success',
            title: 'View saved',
            description: `${trimmed} now sits with the other saved searches.`,
          });
        },
        onError: () => {
          toast({
            variant: 'error',
            title: 'View not saved',
            description: 'The filters on screen are unchanged — try saving again.',
          });
        },
      },
    );
  };

  const remove = (id: string, name: string) => {
    deleteView.mutate(id, {
      onSuccess: () => {
        toast({
          variant: 'success',
          title: 'View removed',
          description: `${name} is gone from the list. The events it selected are untouched.`,
        });
      },
      onError: () => {
        toast({ variant: 'error', title: 'View not removed', description: 'Nothing changed.' });
      },
    });
  };

  return (
    <div ref={wrapperRef} className="relative inline-flex">
      <Button
        variant="secondary"
        leadingIcon={Bookmark}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setOpen((value) => !value);
          setDraftName(null);
        }}
      >
        Saved views
      </Button>

      {open && floating.container ? createPortal(
        <div
          ref={floating.floatingRef}
          style={floating.style}
          data-placement={floating.placement}
          id={panelId}
          role="group"
          aria-label="Saved views"
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false);
          }}
          className="z-dropdown w-72 overflow-y-auto rounded-surface border border-border bg-surface-overlay p-2 shadow-popover"
        >
          {saved.length === 0 ? (
            <p className="px-2 py-3 text-body-sm text-text-tertiary">
              {views.isLoading ? 'Reading saved views…' : 'No saved views yet.'}
            </p>
          ) : (
            <ul className="flex flex-col">
              {saved.map((view) => (
                <li key={view.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      onApply(view.filters);
                      setOpen(false);
                    }}
                    className="min-w-0 flex-1 truncate rounded-control px-2 py-2 text-start text-body-sm text-text-primary transition-colors duration-fast hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                  >
                    {view.name}
                  </button>
                  {/*
                   * The view's name is in the label, not just "Delete": a
                   * reader moving through this list by keyboard hears which
                   * of five saved searches the button would remove.
                   */}
                  <IconButton
                    icon={Trash2}
                    variant="ghost"
                    size="sm"
                    aria-label={`Delete saved view ${view.name}`}
                    disabled={deleteView.isPending}
                    onClick={() => {
                      remove(view.id, view.name);
                    }}
                  />
                </li>
              ))}
            </ul>
          )}

          <div className="mt-2 border-t border-border pt-2">
            {draftName === null ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  fullWidth
                  // A view with no filters saves nothing to come back to —
                  // "Clear filters" is already the way back to everything.
                  disabled={active === 0}
                  onClick={() => {
                    setDraftName('');
                  }}
                >
                  Save current filters
                </Button>
                {active === 0 ? (
                  <p className="mt-1 px-2 text-caption text-text-secondary">
                    Narrow the log first — a view of everything is the log itself.
                  </p>
                ) : null}
              </>
            ) : (
              <div className="flex flex-col gap-2">
                <Input
                  label="View name"
                  value={draftName}
                  onChange={(event) => {
                    setDraftName(event.target.value);
                  }}
                  placeholder="Failed logins 7d"
                />
                <div className="flex items-center justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setDraftName(null);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    disabled={trimmed === ''}
                    loading={createView.isPending}
                    onClick={save}
                  >
                    Save
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>,
        floating.container,
      ) : null}
    </div>
  );
}
