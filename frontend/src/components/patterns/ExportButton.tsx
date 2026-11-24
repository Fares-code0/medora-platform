import { Download, FileSpreadsheet, FileText, Printer, Table } from 'lucide-react';

import { Button, Dropdown, type MenuEntry , type ButtonSize, type ButtonVariant } from '@/components/ui';
import { useT, type MessageKey } from '@/i18n';
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

const FORMAT_META: readonly { id: ExportFormat; labelKey: MessageKey; icon: typeof Table }[] = [
  { id: 'csv', labelKey: 'ui.exportCsv', icon: Table },
  { id: 'excel', labelKey: 'ui.exportExcel', icon: FileSpreadsheet },
  { id: 'pdf', labelKey: 'ui.exportPdf', icon: FileText },
  { id: 'print', labelKey: 'ui.print', icon: Printer },
];

export function ExportButton({
  getDataset,
  label,
  variant = 'secondary',
  size = 'md',
  disabled = false,
  onExported,
}: ExportButtonProps) {
  const t = useT();
  const entries: readonly MenuEntry[] = FORMAT_META.map((format) => ({
    id: format.id,
    label: t(format.labelKey),
    icon: format.icon,
    onSelect: () => {
      runExport(format.id, getDataset());
      onExported?.(format.id);
    },
  }));

  return (
    <Dropdown
      align="end"
      menuLabel={t('ui.exportOptions')}
      entries={entries}
      trigger={
        <Button variant={variant} size={size} leadingIcon={Download} disabled={disabled}>
          {label ?? t('ui.export')}
        </Button>
      }
    />
  );
}
