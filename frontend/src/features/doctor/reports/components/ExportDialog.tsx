import { useState } from 'react';

import { Check, FileSpreadsheet, FileText, Printer, Table } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { useToast } from '@/app/providers';
import { Button, Modal } from '@/components/ui';
import { cn } from '@/utils/cn';
import { runExport, type ExportDataset } from '@/utils/export';

import { useExportMutation } from '../api/useReportsQueries';
import { formatNumber } from '../model/selectors';
import { EXPORT_FORMATS, type AnalyticsSnapshot, type ExportFormat } from '../model/types';

/**
 * Export dialog — pick a format and generate the report for real. Every
 * format runs through the shared export engine (@/utils/export): CSV and
 * Excel download genuine files, PDF is a real (hand-rolled) PDF, and Print
 * opens the browser print dialog. A short "generating" latency comes from the
 * mock mutation. The format list is the single source of truth.
 */

const FORMAT_ICON: Record<ExportFormat, LucideIcon> = {
  csv: Table,
  excel: FileSpreadsheet,
  pdf: FileText,
  print: Printer,
};

function buildReportDataset(snapshot: AnalyticsSnapshot): ExportDataset {
  const rows: (string | number)[][] = [];
  snapshot.kpis.forEach((kpi) => rows.push(['KPI', kpi.label, kpi.value]));
  snapshot.departments.forEach((slice) => rows.push(['Department', slice.label, slice.value]));
  snapshot.labStatus.forEach((slice) => rows.push(['Lab status', slice.label, slice.value]));
  snapshot.weekday.points.forEach((point) => rows.push(['Weekday', point.label, point.value]));
  snapshot.pharmacy.points.forEach((point) => rows.push(['Pharmacy', point.label, point.value]));
  return {
    filename: 'medora-report',
    title: 'Analytics report',
    columns: ['Section', 'Label', 'Value'],
    rows,
  };
}

export interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
  snapshot: AnalyticsSnapshot | undefined;
}

export function ExportDialog({ open, onClose, snapshot }: ExportDialogProps) {
  const { toast } = useToast();
  const exportMutation = useExportMutation();
  const [format, setFormat] = useState<ExportFormat>('csv');

  /*
   * Nothing to export until the analytics have loaded. The header's Export
   * button is always enabled — while the report loads and after it fails —
   * and this dialog used to toast "Exported as CSV" over a file it never
   * wrote, because `runExport` was skipped without a snapshot and the toast
   * was not. The button now waits for the data it exports.
   */
  const run = () => {
    if (!snapshot) return;
    exportMutation.mutate(format, {
      onSuccess: () => {
        runExport(format, buildReportDataset(snapshot));
        const label = EXPORT_FORMATS.find((f) => f.id === format)?.label ?? format;
        toast({
          variant: 'success',
          title: format === 'print' ? 'Sent to printer' : `Exported as ${label}`,
        });
        onClose();
      },
      onError: () =>
        toast({
          variant: 'error',
          title: 'Export failed',
          description: 'No file was created. Please try again.',
        }),
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Export report"
      description="Choose a format for the current analytics view."
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={exportMutation.isPending}>
            Cancel
          </Button>
          <Button onClick={run} loading={exportMutation.isPending} disabled={!snapshot}>
            Export
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        {EXPORT_FORMATS.map((option) => {
          const Icon = FORMAT_ICON[option.id];
          const selected = option.id === format;
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={selected}
              onClick={() => setFormat(option.id)}
              className={cn(
                'relative flex flex-col items-start gap-1 rounded-surface border p-3 text-start transition-colors duration-base',
                selected
                  ? 'border-primary bg-primary-subtle'
                  : 'border-border-strong bg-surface hover:border-text-disabled',
              )}
            >
              {selected ? (
                <span
                  aria-hidden="true"
                  className="absolute end-2 top-2 flex h-4 w-4 items-center justify-center rounded-pill bg-primary text-text-inverse"
                >
                  <Check className="h-3 w-3" strokeWidth={2.5} />
                </span>
              ) : null}
              <span
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-surface',
                  selected
                    ? 'bg-primary text-text-inverse'
                    : 'bg-surface-sunken text-text-secondary',
                )}
              >
                <Icon className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
              </span>
              <span
                className={cn(
                  'text-body-sm font-semibold',
                  selected ? 'text-primary' : 'text-text-primary',
                )}
              >
                {option.label}
              </span>
              <span className="text-caption text-text-secondary">{option.description}</span>
            </button>
          );
        })}
      </div>
      {snapshot ? (
        <p className="mt-3 text-caption text-text-secondary">
          {formatNumber(
            snapshot.kpis.length + snapshot.departments.length + snapshot.labStatus.length,
          )}{' '}
          data points across KPIs and breakdowns will be included.
        </p>
      ) : (
        <p className="mt-3 text-caption text-text-secondary">
          The analytics have not loaded, so there is nothing to export yet.
        </p>
      )}
    </Modal>
  );
}
