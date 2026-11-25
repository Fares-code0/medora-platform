import type { CSSProperties } from 'react';

import { AnimatePresence, m } from 'framer-motion';

import { useModalDialog } from '@/components/ui/internal/useModalDialog';
import { useIsRtl, useT } from '@/i18n';
import { EASE_EMPHASIZED, motionTokens } from '@/styles/motion';

import { type NavigationConfig } from './navigation';
import { AppSidebar } from './Sidebar/AppSidebar';

/**
 * MobileNavDrawer — the ☰ overlay navigation for md and below (UX §5.1).
 * Shell chrome owned by layouts (FRONTEND_ARCHITECTURE §4): a native
 * <dialog> (focus trap, Esc, inert background for free) pinned to the
 * inline-start edge (F-19: the left in English, the right in Arabic), sliding the full expanded AppSidebar in over 250ms. The DS
 * Drawer primitive is right-pinned by spec (§8.15), so the left-edge
 * variant lives here with the shell rather than forking the primitive.
 */
export interface MobileNavDrawerProps {
  open: boolean;
  onClose: () => void;
  config: NavigationConfig;
}

export function MobileNavDrawer({ open, onClose, config }: MobileNavDrawerProps) {
  const rtl = useIsRtl();
  const t = useT();
  const { dialogRef, closing, onExitComplete } = useModalDialog(open, onClose);
  const duration = motionTokens.duration.panel;
  const offstage = rtl ? '100%' : '-100%';

  return (
    <dialog
      ref={dialogRef}
      aria-modal="true"
      aria-label={t('shell.navigation')}
      data-motion=""
      data-closing={closing ? '' : undefined}
      style={{ '--dialog-motion': `${String(duration * 1000)}ms` } as CSSProperties}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
      className="fixed start-0 m-0 h-dvh max-h-dvh w-full max-w-[288px] overflow-hidden bg-transparent p-0 backdrop:bg-scrim"
    >
      <AnimatePresence onExitComplete={onExitComplete}>
        {open ? (
          <m.div
            key="mobile-nav-panel"
            /* The drawer enters from the side the nav lives on, which the
             locale decides: sliding in from the left in Arabic would cross
             the whole screen to land on the right. `x` is a physical
             transform — one of the few things `dir` does not mirror. */
            initial={{ x: offstage }}
            animate={{ x: 0 }}
            exit={{ x: offstage }}
            transition={{ duration, ease: EASE_EMPHASIZED }}
            className="h-full overflow-hidden rounded-e-surface shadow-modal"
          >
            <AppSidebar config={config} onNavigate={onClose} className="h-full" compactFooter />
          </m.div>
        ) : null}
      </AnimatePresence>
    </dialog>
  );
}
