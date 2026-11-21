import { useState } from 'react';

import {
  CheckCircle2,
  Laptop,
  LogOut,
  Monitor,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  XCircle,
} from 'lucide-react';
import { type LucideIcon } from 'lucide-react';

import { useAuth, useToast } from '@/app/providers';
import { Badge, Button, ConfirmationDialog, Switch } from '@/components/ui';

import {
  useRemoveTrustedDeviceMutation,
  useRevokeOtherSessionsMutation,
  useRevokeSessionMutation,
  useUpdateSecurityMutation,
} from '../api/useSettingsQueries';
import { SettingsCard } from '../components/SettingsCard';
import { SettingsRow } from '../components/SettingsRow';
import {
  TwoFactorDisableDialog,
  TwoFactorEnrolDialog,
  TwoFactorReenrollDialog,
} from '../components/TwoFactorDialogs';
import { formatDate, formatDateTime, selectSecurityPosture } from '../model/selectors';
import type { SettingsDocument, TrustedDevice } from '../model/types';
import { settingsService } from '../service';

const PLATFORM_ICON: Record<TrustedDevice['platform'], LucideIcon> = {
  windows: Monitor,
  mac: Laptop,
  ios: Smartphone,
  android: Smartphone,
  desktop: Monitor,
  mobile: Smartphone,
  tablet: Smartphone,
};

const POSTURE_STYLE: Record<
  ReturnType<typeof selectSecurityPosture>['level'],
  { chip: string; icon: LucideIcon }
> = {
  strong: { chip: 'bg-success-subtle text-success', icon: ShieldCheck },
  good: { chip: 'bg-info-subtle text-info', icon: ShieldCheck },
  'at-risk': { chip: 'bg-error-subtle text-error', icon: ShieldAlert },
};

export function SecuritySection({ document }: { document: SettingsDocument }) {
  const { toast } = useToast();
  const { logout } = useAuth();
  const updateSecurity = useUpdateSecurityMutation();
  const revokeSession = useRevokeSessionMutation();
  const revokeOthers = useRevokeOtherSessionsMutation();
  const removeDevice = useRemoveTrustedDeviceMutation();

  const [confirmDisable2fa, setConfirmDisable2fa] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [disabling, setDisabling] = useState(false);
  const [reenrolling, setReenrolling] = useState(false);
  // Live, two-factor is switched through the server's enrolment flow.
  const enrolment = settingsService.capabilities.twoFactorEnrolment;
  const [confirmLogoutOthers, setConfirmLogoutOthers] = useState(false);

  const { security, account } = document;
  const posture = selectSecurityPosture(security, account.passwordUpdatedAt);
  const postureStyle = POSTURE_STYLE[posture.level];
  const PostureIcon = postureStyle.icon;
  const otherSessions = security.activeSessions.filter((session) => !session.current).length;
  // Known only from `GET /me/2fa` (R2), which shipped with re-enrolment (R4):
  // a count is what says this server can replace the authenticator.
  const recoveryCodes = security.recoveryCodesRemaining;
  const showRecovery = enrolment && security.twoFactorEnabled && recoveryCodes !== null;

  const setTwoFactor = (enabled: boolean) => {
    updateSecurity.mutate(
      { twoFactorEnabled: enabled },
      {
        onSuccess: () =>
          toast({
            variant: 'success',
            title: enabled ? 'Two-factor authentication on' : 'Two-factor authentication off',
          }),
      },
    );
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Security status */}
      <div className="rounded-surface border border-border bg-surface p-5">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-surface ${postureStyle.chip}`}
          >
            <PostureIcon className="h-5 w-5" strokeWidth={1.75} />
          </span>
          <div className="min-w-0">
            <h2 className="text-h5 font-semibold text-text-primary">{posture.headline}</h2>
            <ul className="mt-2 flex flex-col gap-1.5">
              {posture.items.map((item) => (
                <li key={item.label} className="flex items-center gap-2 text-body-sm">
                  {item.ok ? (
                    <CheckCircle2
                      className="h-4 w-4 shrink-0 text-success"
                      strokeWidth={1.75}
                      aria-hidden="true"
                    />
                  ) : (
                    <XCircle
                      className="h-4 w-4 shrink-0 text-text-disabled"
                      strokeWidth={1.75}
                      aria-hidden="true"
                    />
                  )}
                  <span className={item.ok ? 'text-text-secondary' : 'text-text-primary'}>
                    {item.label}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Two-factor authentication */}
      <SettingsCard
        title="Two-factor authentication"
        description="Require a one-time code at sign-in for an extra layer of protection."
        icon={ShieldCheck}
      >
        <SettingsRow
          title="Authenticator app"
          description={
            security.twoFactorEnabled
              ? 'Enabled — codes come from your authenticator app.'
              : 'Add a second step to every sign-in. Recommended.'
          }
          control={
            <Switch
              aria-label="Two-factor authentication"
              checked={security.twoFactorEnabled}
              onCheckedChange={(checked) => {
                if (enrolment) {
                  if (checked) setEnrolling(true);
                  else setDisabling(true);
                  return;
                }
                if (checked) setTwoFactor(true);
                else setConfirmDisable2fa(true);
              }}
            />
          }
        />
        {showRecovery ? (
          <>
            <SettingsRow
              title="Recovery codes"
              description={recoveryCodesDescription(recoveryCodes)}
              control={
                <Badge
                  variant={
                    recoveryCodes === 0 ? 'error' : recoveryCodes <= 2 ? 'warning' : 'neutral'
                  }
                >
                  {recoveryCodes === 1 ? '1 left' : `${String(recoveryCodes)} left`}
                </Badge>
              }
            />
            <SettingsRow
              title="Replace authenticator app"
              description="Move Medora to a new phone or app. Needs your password and a code from the app you use now, and issues a new set of recovery codes."
              control={
                <Button variant="secondary" size="sm" onClick={() => setReenrolling(true)}>
                  Replace…
                </Button>
              }
            />
          </>
        ) : null}
      </SettingsCard>

      {/* Trusted devices */}
      <SettingsCard
        title="Trusted devices"
        description="Devices that skip two-factor prompts for 30 days."
        icon={Laptop}
        flush
      >
        <ul className="divide-y divide-border px-5">
          {security.trustedDevices.map((device) => {
            const Icon = PLATFORM_ICON[device.platform];
            return (
              <li key={device.id} className="flex items-center gap-3 py-3.5">
                <span
                  aria-hidden="true"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-surface bg-surface-sunken text-text-secondary"
                >
                  <Icon className="h-4 w-4" strokeWidth={1.75} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-body-sm font-medium text-text-primary">{device.name}</p>
                  <p className="text-caption text-text-tertiary">
                    Added {formatDate(device.addedAt)} · Last active {formatDate(device.lastSeenAt)}
                  </p>
                </div>
                {device.current ? (
                  <Badge variant="success" dot>
                    Current
                  </Badge>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => removeDevice.mutate(device.id)}>
                    Remove
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </SettingsCard>

      {/* Active sessions */}
      <SettingsCard
        title="Active sessions"
        description="Where you're currently signed in."
        icon={Monitor}
        action={
          otherSessions > 0 ? (
            <Button
              variant="destructive-secondary"
              size="sm"
              leadingIcon={LogOut}
              onClick={() => setConfirmLogoutOthers(true)}
            >
              Sign out others
            </Button>
          ) : undefined
        }
        flush
      >
        <ul className="divide-y divide-border px-5">
          {security.activeSessions.map((session) => {
            const Icon = /iphone|ios|android|app/i.test(session.browser) ? Smartphone : Monitor;
            return (
              <li key={session.id} className="flex items-center gap-3 py-3.5">
                <span
                  aria-hidden="true"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-surface bg-surface-sunken text-text-secondary"
                >
                  <Icon className="h-4 w-4" strokeWidth={1.75} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-body-sm font-medium text-text-primary">
                    {session.device}
                    {session.current ? (
                      <Badge variant="success" dot>
                        This device
                      </Badge>
                    ) : null}
                  </p>
                  <p className="text-caption text-text-tertiary">
                    {session.browser} · {session.location} · {session.ipAddress}
                  </p>
                  <p className="text-caption text-text-tertiary">
                    Started {formatDateTime(session.startedAt)}
                  </p>
                </div>
                {!session.current ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => revokeSession.mutate(session.id)}
                  >
                    Revoke
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      </SettingsCard>

      {/* Login history */}
      <SettingsCard
        title="Recent login history"
        description="The last few sign-in attempts on your account."
        icon={Monitor}
        flush
      >
        <ul className="divide-y divide-border px-5">
          {security.loginHistory.map((event) => (
            <li key={event.id} className="flex items-center gap-3 py-3">
              {event.status === 'success' ? (
                <CheckCircle2
                  className="h-4 w-4 shrink-0 text-success"
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
              ) : (
                <XCircle
                  className="h-4 w-4 shrink-0 text-error"
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-body-sm text-text-primary">
                  {event.status === 'success' ? 'Successful sign-in' : 'Failed sign-in attempt'}
                </p>
                <p className="text-caption text-text-tertiary">
                  {event.device} · {event.location}
                </p>
              </div>
              <time className="shrink-0 text-caption text-text-tertiary">
                {formatDateTime(event.at)}
              </time>
            </li>
          ))}
        </ul>
      </SettingsCard>

      <ConfirmationDialog
        open={confirmDisable2fa}
        onClose={() => setConfirmDisable2fa(false)}
        onConfirm={() => {
          setConfirmDisable2fa(false);
          setTwoFactor(false);
        }}
        title="Turn off two-factor authentication?"
        description="Your account will be less protected. You can turn it back on at any time."
        confirmLabel="Turn off"
      />

      <TwoFactorEnrolDialog
        open={enrolling}
        onClose={() => setEnrolling(false)}
        onEnabled={() => toast({ variant: 'success', title: 'Two-factor authentication on' })}
        onSignedOut={() => void logout()}
      />
      <TwoFactorDisableDialog
        open={disabling}
        onClose={() => setDisabling(false)}
        onDisabled={() => {
          // The server has already ended this session (see TwoFactorDialogs).
          toast({
            variant: 'success',
            title: 'Two-factor authentication off',
            description: 'You have been signed out everywhere. Sign in again to continue.',
          });
          void logout();
        }}
        onSignedOut={() => void logout()}
      />

      <TwoFactorReenrollDialog
        open={reenrolling}
        onClose={() => setReenrolling(false)}
        onReplaced={() =>
          toast({
            variant: 'success',
            title: 'Authenticator app replaced',
            description: 'Your old app and old recovery codes no longer work.',
          })
        }
        onSignedOut={() => void logout()}
      />

      <ConfirmationDialog
        open={confirmLogoutOthers}
        onClose={() => setConfirmLogoutOthers(false)}
        tone="primary"
        onConfirm={() => {
          setConfirmLogoutOthers(false);
          revokeOthers.mutate(undefined, {
            onSuccess: () => toast({ variant: 'success', title: 'Signed out of other sessions' }),
          });
        }}
        title="Sign out of all other sessions?"
        description="You'll stay signed in on this device. Every other session will be ended."
        confirmLabel="Sign out others"
      />
    </div>
  );
}

/**
 * The server issues new recovery codes only with a new authenticator — no
 * route regenerates them alone — so running low points at re-enrolment.
 */
function recoveryCodesDescription(remaining: number): string {
  if (remaining === 0) {
    return 'None left. If you lose your authenticator app you cannot sign in. Replace the app to get a new set.';
  }
  if (remaining <= 2) {
    return 'Running low. Each code signs you in once without your app; replacing the app issues a new set.';
  }
  return 'Each code signs you in once if you lose your authenticator app.';
}
