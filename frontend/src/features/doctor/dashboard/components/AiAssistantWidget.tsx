import { useNavigate } from 'react-router-dom';

import { DashboardWidget, StatusBadge } from '@/components/patterns';
import { Button } from '@/components/ui';
import { routes } from '@/routes';
import { MedoraAiLogo } from '@/shared/components/branding';

import type { DashboardWidgetSlotProps } from '../model/widgets';

/**
 * Medora AI widget (placeholder) — entry point to the UX 2.5
 * workspace. Renders in the accent AI container per the provenance rule
 * (UX 1.5: AI surfaces are always visually distinct); capability cards
 * and the chat workspace land with the ai-assistant feature.
 *
 * The card itself is a plain white card, like every other widget (no tone
 * edge): its AI identity is carried by the Medora AI logo, the AI badge and
 * the accent container inside it.
 */
export function AiAssistantWidget({ menu, className }: Partial<DashboardWidgetSlotProps>) {
  const navigate = useNavigate();

  return (
    <DashboardWidget
      title="Medora AI"
      actions={<StatusBadge status="ai" label="AI" />}
      menu={menu}
      className={className}
    >
      <div className="flex flex-col gap-4 rounded-surface border border-accent bg-accent-subtle p-4">
        <p className="text-body-sm text-text-primary">
          Summarize histories, draft consultation notes, and interpret lab results — always reviewed
          by you before anything reaches a record.
        </p>
        <p className="text-caption text-text-secondary">
          Medora AI supports, but never replaces, clinical judgment.
        </p>
        <Button
          variant="ai"
          leadingIcon={MedoraAiLogo}
          onClick={() => navigate(routes.doctor.assistant)}
          className="self-start"
        >
          Open Medora AI
        </Button>
      </div>
    </DashboardWidget>
  );
}
