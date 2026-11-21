import type { ReactNode } from 'react';

import { useAdminSearchIndex } from '@/features/admin/useAdminSearchIndex';
import { ShellSearchContext } from '@/layouts';

/**
 * Fills the shell's domain-free search seam for the admin area. Lives in the
 * APP layer for the same reason ShellBadgesProvider does: `layouts/` may not
 * import features (§1.2), so the composition happens here.
 *
 * One module per role (NEW-21): the router lazy-loads each provider, and
 * when both lived in one module, loading the doctor's downloaded the admin
 * index too. The admin index is in memory, so it needs no activation.
 */
export function AdminShellSearchProvider({ children }: { children: ReactNode }) {
  const value = useAdminSearchIndex();
  return <ShellSearchContext.Provider value={value}>{children}</ShellSearchContext.Provider>;
}
