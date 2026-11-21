import { Download, FileSpreadsheet, FileText, Printer, Table } from 'lucide-react';

import { Button, Dropdown, type MenuEntry , type ButtonSize, type ButtonVariant } from '@/components/ui';
import { runExport, type ExportDataset, type ExportFormat } from '@/utils/export';

/**
 * ExportButton — a single control that produces real files (CSV, Excel, PDF)
 * or opens the print dialog, used by every "Export" action in the app so no
 * export is a fake dialog. The dataset is built lazily on click, so it always
 * reflects the current view. Pages pass `onExported` to show a success toast.
 */
export interface ExportButtonProps {
  /** Built on demand so the export reflects the current filtered view. */
  getDataset: () => ExportDataset;
  label?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  onExported?: ((format: ExportFormat) => void) | undefined;
}

const FORMAT_META: readonly { id: ExportFormat; label: string; icon: typeof Table }[] = [
  { id: 'csv', label: 'Export as CSV', icon: Table },
  { id: 'excel', label: 'Export as Excel', icon: FileSpreadsheet },
  { id: 'pdf', label: 'Export as PDF', icon: FileText },
  { id: 'print', label: 'Print', icon: Printer },
];

export function ExportButton({
  getDataset,
  label = 'Export',
  variant = 'secondary',
  size = 'md',
  disabled = false,
  onExported,
}: ExportButtonProps) {
  const entries: readonly MenuEntry[] = FORMAT_META.map((format) => ({
    id: format.id,
    label: format.label,
    icon: format.icon,
    onSelect: () => {
      runExport(format.id, getDataset());
      onExported?.(format.id);
    },
  }));

  return (
    <Dropdown
      align="end"
      menuLabel="Export options"
      entries={entries}
      trigger={
        <Button variant={variant} size={size} leadingIcon={Download} disabled={disabled}>
          {label}
        </Button>
      }
    />
  );
}
