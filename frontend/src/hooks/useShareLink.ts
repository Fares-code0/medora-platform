import { useCallback } from 'react';

import { useToast } from '@/app/providers';
import { copyText } from '@/utils/clipboard';

/**
 * Share-by-link — copies an app path as an absolute URL to the clipboard
 * with toast feedback. Backs the medical record's "Share" (row menu and
 * detail page).
 *
 * Sharing grants nothing (DEC-016): the link is the record's ordinary
 * address, and whoever opens it is authorized by the server like any other
 * visit. The success toast says so, so nobody mistakes a copied link for
 * having given a colleague access. When the copy cannot happen — refused, or
 * no clipboard outside a secure context — the error toast carries the link
 * itself, so the user is never left without it.
 */
export function useShareLink() {
  const { toast } = useToast();

  return useCallback(
    async (path: string): Promise<void> => {
      const url = `${window.location.origin}${path}`;
      try {
        await copyText(url);
        toast({
          variant: 'success',
          title: 'Link copied',
          description: 'Colleagues need their own access to this patient to open it.',
        });
      } catch {
        toast({
          variant: 'error',
          title: 'Could not copy the link',
          description: `Copy it from here: ${url}`,
        });
      }
    },
    [toast],
  );
}
