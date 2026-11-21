import { useState } from 'react';

import { CalendarDays, CheckCircle2, Video } from 'lucide-react';

import { useToast } from '@/app/providers';
import { Badge, Button, ConfirmationDialog } from '@/components/ui';

import { useToggleIntegrationMutation } from '../api/useSettingsQueries';
import { SettingsCard } from '../components/SettingsCard';
import { formatDate } from '../model/selectors';
import {
  INTEGRATION_META,
  type IntegrationId,
  type IntegrationMeta,
  type SettingsDocument,
} from '../model/types';
import { settingsService } from '../service';

/**
 * Integrations section — calendar and meeting tools. In the demo, Connect
 * simulates the OAuth handshake (a real flow would redirect); it stores a
 * mock account and flips the status. Live, the state is the server's (RM
 * M22) and Connect is not offered: the server answers 501 until an OAuth
 * client is configured for the provider (`capabilities.integrationConnect`),
 * so each unconnected tool says so instead of carrying a button that can
 * only fail. Disconnect is confirmed, and offered whenever one is connected.
 * Grouped by category, matching the connected-apps pattern in enterprise
 * settings.
 */

const CATEGORY_ICON: Record<IntegrationMeta['category'], typeof CalendarDays> = {
  Calendar: CalendarDays,
  Meetings: Video,
};

export function IntegrationsSection({ document }: { document: SettingsDocument }) {
  const { toast } = useToast();
  const toggle = useToggleIntegrationMutation();
  const [disconnectId, setDisconnectId] = useState<IntegrationId | null>(null);

  const stateOf = (id: IntegrationId) =>
    document.integrations.find((integration) => integration.id === id);

  const disconnectMeta = disconnectId
    ? INTEGRATION_META.find((meta) => meta.id === disconnectId)
    : undefined;

  const categories: IntegrationMeta['category'][] = ['Calendar', 'Meetings'];

  const connect = (id: IntegrationId) => {
    toggle.mutate(
      { id, connect: true, account: null },
      {
        onSuccess: () => toast({ variant: 'success', title: 'Connected' }),
        onError: () =>
          toast({
            variant: 'error',
            title: 'Could not connect',
            description: 'Nothing was changed.',
          }),
      },
    );
  };

  return (
    <div className="flex flex-col gap-5">
      {categories.map((category) => {
        const Icon = CATEGORY_ICON[category];
        const items = INTEGRATION_META.filter((meta) => meta.category === category);
        return (
          <SettingsCard
            key={category}
            title={category}
            description={
              category === 'Calendar'
                ? 'Sync appointments with your calendar.'
                : 'Launch telehealth visits from Medora.'
            }
            icon={Icon}
            flush
          >
            <ul className="divide-y divide-border px-5">
              {items.map((meta) => {
                const state = stateOf(meta.id);
                const connected = state?.connected ?? false;
                return (
                  <li key={meta.id} className="flex items-center gap-3 py-4">
                    <span
                      aria-hidden="true"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-surface bg-surface-sunken text-text-secondary"
                    >
                      <Icon className="h-4 w-4" strokeWidth={1.75} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-body-sm font-medium text-text-primary">
                        {meta.name}
                        {connected ? (
                          <Badge variant="success" icon={CheckCircle2}>
                            Connected
                          </Badge>
                        ) : null}
                      </p>
                      <p className="text-caption text-text-tertiary">
                        {connected && state?.account
                          ? `${state.account}${
                              state.connectedAt ? ` · since ${formatDate(state.connectedAt)}` : ''
                            }`
                          : meta.description}
                      </p>
                    </div>
                    {connected ? (
                      <Button variant="ghost" size="sm" onClick={() => setDisconnectId(meta.id)}>
                        Disconnect
                      </Button>
                    ) : !settingsService.capabilities.integrationConnect ? (
                      <span className="max-w-40 text-end text-caption text-text-tertiary">
                        Connecting is not available yet
                      </span>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={toggle.isPending && toggle.variables?.id === meta.id}
                        onClick={() => connect(meta.id)}
                      >
                        Connect
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </SettingsCard>
        );
      })}

      <ConfirmationDialog
        open={disconnectId !== null}
        onClose={() => setDisconnectId(null)}
        tone="primary"
        onConfirm={() => {
          if (!disconnectId) return;
          const id = disconnectId;
          setDisconnectId(null);
          toggle.mutate(
            { id, connect: false, account: null },
            {
              onSuccess: () => toast({ variant: 'success', title: 'Disconnected' }),
              onError: () =>
                toast({
                  variant: 'error',
                  title: 'Could not disconnect',
                  description: 'It is still connected. Please try again.',
                }),
            },
          );
        }}
        title={`Disconnect ${disconnectMeta?.name ?? 'integration'}?`}
        description="Medora will stop syncing with this service. You can reconnect at any time."
        confirmLabel="Disconnect"
      />
    </div>
  );
}
