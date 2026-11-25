import { useCallback } from 'react';

import { useNavigate } from 'react-router-dom';

import { routes } from '@/routes';

/**
 * The one "New message" action. Every New message button in the workspace
 * (folder rail, the mobile chip row above the list, the empty chat panel)
 * calls this, so they cannot drift to different destinations.
 */
export function useStartNewMessage(): () => void {
  const navigate = useNavigate();
  return useCallback(() => navigate(routes.doctor.newMessage), [navigate]);
}
