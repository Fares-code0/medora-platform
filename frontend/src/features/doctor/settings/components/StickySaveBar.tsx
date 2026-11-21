import { AnimatePresence, m } from 'framer-motion';
import { Check } from 'lucide-react';

import { Button } from '@/components/ui';

/**
 * Sticky save bar — the enterprise account-settings pattern (Stripe/Linear):
 * while a section has unsaved changes, a bar rises from the bottom of the
 * scroll region with Cancel + Save. `sticky bottom-0` pins it inside the
 * shell's scrollable <main>. It reveals only when `visible`, so clean
 * sections stay uncluttered.
 */
export interface StickySaveBarProps {
  visible: boolean;
  onSave: () => void;
  onCancel: () => void;
  saving?: boolean;
  /** Optional context line, e.g. "3 changes". */
  message?: string;
  saveLabel?: string;
}

export function StickySaveBar({
  visible,
  onSave,
  onCancel,
  saving = false,
  message = 'You have unsaved changes',
  saveLabel = 'Save changes',
}: StickySaveBarProps) {
  return (
    <AnimatePresence>
      {visible ? (
        <m.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ duration: 0.2, ease: [0, 0, 0.2, 1] }}
          className="sticky bottom-0 z-sticky -mx-1 mt-2"
        >
          <div className="flex items-center justify-between gap-4 rounded-surface border border-border bg-surface-overlay px-4 py-3 shadow-modal">
            <p className="flex items-center gap-2 text-body-sm font-medium text-text-secondary">
              <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-pill bg-warning" />
              {message}
            </p>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                leadingIcon={Check}
                loading={saving}
                onClick={onSave}
              >
                {saveLabel}
              </Button>
            </div>
          </div>
        </m.div>
      ) : null}
    </AnimatePresence>
  );
}
