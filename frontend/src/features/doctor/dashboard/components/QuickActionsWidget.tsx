import { CalendarDays, FilePlus2, FlaskConical, MessageSquarePlus, Pill } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { DashboardWidget } from '@/components/patterns';
import { Button } from '@/components/ui';
import { routes } from '@/routes';
import { MedoraAiLogo } from '@/shared/components/branding';

import type { DashboardWidgetSlotProps } from '../model/widgets';

/**
 * Quick actions (UX 2.1 Row 4).
 *
 * Every action now opens the flow that owns it rather than navigating to a
 * list and leaving the doctor to find it — DX-22/DX-23 closed. "New
 * prescription" opens D-17's flow, "New record" D-21's, "Order lab" DX-23's,
 * and "Message a patient" the compose picker (D-24). Each
 * used to navigate to a *list*, an action button that was not an action.
 * Both link to the flow their owning feature holds — DX-23's rule, "build
 * the workflow in the owning feature and link it from the dashboard; do not
 * fork a second authoring flow here". Medora AI and the schedule are
 * destinations rather than writes, so they navigate. Pinned by
 * `QuickActionsWidget.test.tsx` (RM M39.5).
 */
export function QuickActionsWidget({ menu, className }: Partial<DashboardWidgetSlotProps>) {
  const navigate = useNavigate();

  return (
    <DashboardWidget title="Quick actions" menu={menu} className={className}>
      {/*
        Columns from the card's own width, not the viewport's. This card has
        no fixed width any more — the doctor decides what sits beside it — so
        a viewport breakpoint says nothing about how much room it has. It used
        to: `sm:grid-cols-2 lg:grid-cols-1` was tuned to the fixed Overview,
        where from `lg` the card was a third of a two-thirds region, about
        205px, and two columns of that clipped "Message a patient" (99px boxes
        holding 101–104px of content, measured by `scripts` QA).

        `auto-fill` with a 9rem floor carries the same rule without the
        assumption: a second column appears only when both buttons can be
        144px, which holds the widest label beside its icon and the button's
        own padding (~138px). The browser pass checks every button on the
        dashboard for clipped content at five widths.
      */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3">
        <Button
          variant="secondary"
          leadingIcon={Pill}
          onClick={() => navigate(routes.doctor.newPrescription())}
        >
          New prescription
        </Button>
        <Button
          variant="secondary"
          leadingIcon={FilePlus2}
          onClick={() => navigate(routes.doctor.newMedicalRecord())}
        >
          New record
        </Button>
        <Button
          variant="secondary"
          leadingIcon={FlaskConical}
          onClick={() => navigate(routes.doctor.newLabOrder())}
        >
          Order lab
        </Button>
        <Button
          variant="ai"
          leadingIcon={MedoraAiLogo}
          onClick={() => navigate(routes.doctor.assistant)}
        >
          Open Medora AI
        </Button>
        <Button
          variant="secondary"
          leadingIcon={MessageSquarePlus}
          onClick={() => navigate(routes.doctor.composeMessage())}
        >
          Message a patient
        </Button>
        <Button
          variant="secondary"
          leadingIcon={CalendarDays}
          onClick={() => navigate(routes.doctor.appointments)}
        >
          Open schedule
        </Button>
      </div>
    </DashboardWidget>
  );
}
