import { Building2 } from 'lucide-react';
import { Navigate, useLocation } from 'react-router-dom';

import { useAuth } from '@/app/providers';
import { EmptyState } from '@/components/feedback';
import { PageContainer, PageSections } from '@/components/layout';
import { LinkButton } from '@/components/ui';
import { routes } from '@/routes';
import { workspaceFor } from '@/routes/workspaces';

/**
 * The pre-Phase-B administration URLs, handled by role (D-27).
 *
 * The area was built under `/doctor` in Phase 17 when it was doctor-facing,
 * became admin-only in Phase 19, and moved to `/admin` in Phase B. Section
 * slugs, deep-linked settings panels and query strings all carry across, so
 * an administrator's bookmarks keep working.
 *
 * **What D-27 found.** For a DOCTOR the redirect was a dead end: an old
 * `/doctor/administration/queue` bookmark bounced to `/admin/queue`, which
 * `RequireRole` answers with a 403 reading *"Your account doesn't include
 * permission to view this area… contact your administrator."* That is the
 * wrong story twice over. It blames the doctor's permissions for a
 * deliberate product decision, and it tells them to escalate something no
 * administrator can grant — the area is admin-only by design, not by
 * misconfiguration. All of it under a URL beginning `/doctor/`.
 *
 * So an administrator is still redirected, and a doctor is told what
 * happened and pointed at the clinic view that IS theirs: their own
 * appointments, which is the one doctor-scoped view of the clinic day the
 * app actually has (UX §2.4, calendar day/week/month).
 *
 * **Why a doctor is not simply sent there instead.** A silent redirect from
 * a bookmark to an unrelated page teaches nothing — the doctor arrives at
 * their calendar with no idea why, and tries the bookmark again tomorrow.
 * The move was deliberate and is worth one sentence.
 */
export function LegacyAdministrationRoute() {
  const { pathname, search, hash } = useLocation();
  const { user } = useAuth();

  if (user?.role === 'admin') {
    const rest = pathname.slice(routes.legacy.administrationRoot.length).replace(/^\/+|\/+$/g, '');
    const target = rest === '' ? routes.admin.root : `${routes.admin.root}/${rest}`;
    return <Navigate to={`${target}${search}${hash}`} replace />;
  }

  // The message below is for doctors, whose clinic board moved. Any other
  // workspace never had these pages; send it home rather than to a
  // doctor's calendar it cannot open.
  if (user !== null && user.role !== 'doctor') {
    return <Navigate to={workspaceFor(user.role).home} replace />;
  }

  return (
    <PageContainer width="2xl">
      <PageSections>
        <EmptyState
          icon={Building2}
          title="Clinic operations moved to the administration area"
          description="Queue, waiting room, rooms and shifts are managed by administrators now. Your own clinic day — today's patients, their times and their status — is on your appointments calendar."
          action={
            <LinkButton href={routes.doctor.appointments}>Go to my appointments</LinkButton>
          }
        />
      </PageSections>
    </PageContainer>
  );
}
