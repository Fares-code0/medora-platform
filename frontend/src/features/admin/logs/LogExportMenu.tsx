import { Download, FileJson, Table } from 'lucide-react';

import { useAuth, useToast } from '@/app/providers';
import { Button, Dropdown, type MenuEntry } from '@/components/ui';

import { useLogMutations } from './api/useLogsQueries';
import type { LogFilters } from './logs.types';

/**
 * Export the log (ADM-07 · UX §3.7) — CSV or JSON, and only ever the rows the
 * filters on screen select.
 *
 * Not `components/patterns/ExportButton`, which every other admin section
 * uses: that one builds its dataset from the rows the page is holding, and
 * this page holds exactly one of them. The service re-runs the same filter
 * over the whole aggregate and writes the file from that, so an export taken
 * on page 1 of a 400-row result is 400 rows rather than 50 — and it appends
 * its own `data-export` event on the way, which §3.7 requires and which is
 * why this cannot be a client-side dispatch either.
 */

export interface LogExportMenuProps {
  /** The filters the file must match — the same object the table was drawn from. */
  filters: LogFilters;
}

export function LogExportMenu({ filters }: LogExportMenuProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { exportEvents } = useLogMutations();

  // The name that goes on the export's own log row. `AuthProvider` types the
  // session as nullable; an export by nobody is still an export, and the
  // fallback is the wording every other admin section writes into its trail.
  const actor = user?.name ?? 'Administrator';

  // A declaration rather than a `const` arrow: the failure toast's Retry calls
  // `run` again with the format that failed, and a function can name itself.
  function run(format: 'csv' | 'json') {
    exportEvents.mutate(
      { format, filters, actor },
      {
        onSuccess: (rowCount) => {
          toast({
            variant: 'success',
            title: 'Export ready',
            description: `${String(rowCount)} rows written as ${format.toUpperCase()}. The export is now in the log itself.`,
          });
        },
        onError: () => {
          toast({
            variant: 'error',
            title: 'Nothing was exported',
            description: 'No file was written and no rows left the platform.',
            /*
             * §3.7 asks for a retry on the failure itself. Without it the only
             * way back is to find the Export menu again and remember which
             * format was asked for — and an export is taken *because* someone
             * is assembling evidence, so the retry carries the same format and
             * the same filters rather than starting the choice over.
             */
            action: {
              label: 'Retry',
              onClick: () => {
                run(format);
              },
            },
          });
        },
      },
    );
  }

  const entries: readonly MenuEntry[] = [
    { id: 'csv', label: 'Export as CSV', icon: Table, onSelect: () => run('csv') },
    { id: 'json', label: 'Export as JSON', icon: FileJson, onSelect: () => run('json') },
  ];

  return (
    <Dropdown
      align="end"
      menuLabel="Export format"
      entries={entries}
      trigger={
        <Button variant="secondary" leadingIcon={Download} loading={exportEvents.isPending}>
          Export
        </Button>
      }
    />
  );
}
