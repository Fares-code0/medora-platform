import { Navigate, NavLink, useNavigate, useParams } from 'react-router-dom';

import { SettingsLayout } from '@/components/layout';
import { Select } from '@/components/ui';
import { useT } from '@/i18n';
import { routes } from '@/routes';
import { cn } from '@/utils/cn';

import {
  SETTINGS_PANELS,
  SETTINGS_PANEL_GROUPS,
  isAdminSettingsPanel,
  type AdminSettingsDocument,
  type AdminSettingsPanelId,
} from '../../admin-settings.types';
import { SECTION_META } from '../../administration.meta';
import { useAdminSettings } from '../../api/useAdminSettingsQueries';
import { AsyncSection, Overline } from '../../components/primitives';

import { SecurityPanel, UsersPanel, ApiKeysPanel, AuditPanel } from './AccessPanels';
import { NotificationsPanel, EmailPanel, SmsPanel } from './CommunicationPanels';
import { GeneralPanel, OrganizationPanel, BrandingPanel, LocalizationPanel } from './GeneralPanels';
import { PermissionMatrixPanel } from './PermissionMatrixPanel';
import {
  IntegrationsPanel,
  BackupPanel,
  RetentionPanel,
  PrivacyPanel,
  AboutPanel,
} from './PlatformPanels';

/**
 * Admin Platform Settings — the settings center of the Administration
 * Center (Phase 18). A full page of its own (`SettingsLayout`, the same
 * frame the doctor and admin "My Settings" pages use): a header with the
 * way back to the Overview, then the grouped category navigation (a Select
 * under lg) beside the active panel. The panel id is the URL segment so
 * every panel is deep-linkable and back/forward works.
 */

function panelPath(panel: AdminSettingsPanelId): string {
  return `${routes.admin.section('settings')}/${panel}`;
}

export function AdminSettingsSection() {
  const t = useT();
  const { panel } = useParams<{ panel: string }>();
  const navigate = useNavigate();

  const active: AdminSettingsPanelId | null =
    panel === undefined ? 'general' : isAdminSettingsPanel(panel) ? panel : null;
  const standalone = active !== null && STANDALONE_PANELS.has(active);
  // Only the panels built on the settings document ask for it: in a live
  // build it is not connected, and Users or Roles must not fail with it.
  const query = useAdminSettings({ enabled: !standalone });

  if (active === null) {
    return <Navigate to={panelPath('general')} replace />;
  }

  const meta = SECTION_META.settings;

  return (
    <SettingsLayout
      title={t(meta.labelKey)}
      caption={t(meta.descriptionKey)}
      icon={meta.icon}
      tone="primary"
      backHref={routes.admin.root}
      backLabel="Back to Overview"
      navigation={
        <>
          {/* Mobile / tablet: a single select */}
          <div className="lg:hidden">
            <Select
              aria-label="Settings panel"
              value={active}
              onChange={(next) => navigate(panelPath(next as AdminSettingsPanelId))}
              options={SETTINGS_PANELS.map((item) => ({
                value: item.id,
                label: item.label,
                group: item.group,
              }))}
            />
          </div>

          {/* Desktop: the grouped rail (the layout keeps its column sticky) */}
          <nav aria-label="Settings panels" className="hidden lg:block">
            <div className="flex flex-col gap-4">
              {SETTINGS_PANEL_GROUPS.map((group) => (
                <div key={group}>
                  <div className="px-3 pb-1.5">
                    <Overline>{group}</Overline>
                  </div>
                  <ul className="flex flex-col gap-0.5">
                    {SETTINGS_PANELS.filter((item) => item.group === group).map((item) => (
                      <li key={item.id}>
                        <NavLink
                          to={panelPath(item.id)}
                          className={cn(
                            'flex items-center gap-2.5 rounded-surface px-3 py-2 text-body-sm font-medium transition-colors duration-fast',
                            item.id === active
                              ? 'bg-primary-subtle text-primary'
                              : 'text-text-secondary hover:bg-surface-sunken hover:text-text-primary',
                          )}
                          aria-current={item.id === active ? 'page' : undefined}
                        >
                          <item.icon
                            aria-hidden="true"
                            className="h-4 w-4 shrink-0"
                            strokeWidth={1.75}
                          />
                          {item.label}
                        </NavLink>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </nav>
        </>
      }
    >
      {standalone ? (
        <StandalonePanel panel={active} />
      ) : (
        <AsyncSection
          isLoading={query.isLoading}
          isError={query.isError}
          error={query.error}
          onRetry={() => void query.refetch()}
        >
          {query.data ? <PanelRouter panel={active} document={query.data} /> : null}
        </AsyncSection>
      )}
    </SettingsLayout>
  );
}

/**
 * Panels that read their own data rather than the settings document (FE-10.10):
 * Users and Roles through the access service — live in a live build — and the
 * audit feed through its own query.
 */
const STANDALONE_PANELS: ReadonlySet<AdminSettingsPanelId> = new Set<AdminSettingsPanelId>([
  'users',
  'roles',
  'audit',
]);

function StandalonePanel({ panel }: { panel: AdminSettingsPanelId }) {
  switch (panel) {
    case 'users':
      return <UsersPanel />;
    case 'roles':
      return <PermissionMatrixPanel />;
    default:
      return <AuditPanel />;
  }
}

function PanelRouter({
  panel,
  document,
}: {
  panel: AdminSettingsPanelId;
  document: AdminSettingsDocument;
}) {
  switch (panel) {
    case 'general':
      return <GeneralPanel document={document} />;
    case 'organization':
      return <OrganizationPanel document={document} />;
    case 'branding':
      return <BrandingPanel document={document} />;
    case 'localization':
      return <LocalizationPanel document={document} />;
    case 'notifications':
      return <NotificationsPanel document={document} />;
    case 'email':
      return <EmailPanel document={document} />;
    case 'sms':
      return <SmsPanel document={document} />;
    case 'security':
      return <SecurityPanel document={document} />;
    case 'users':
    case 'roles':
    case 'audit':
      return <StandalonePanel panel={panel} />;
    case 'api-keys':
      return <ApiKeysPanel document={document} />;
    case 'integrations':
      return <IntegrationsPanel document={document} />;
    case 'backup':
      return <BackupPanel document={document} />;
    case 'retention':
      return <RetentionPanel document={document} />;
    case 'privacy':
      return <PrivacyPanel document={document} />;
    case 'about':
      return <AboutPanel />;
  }
}
