import { Suspense, type ReactNode } from 'react';

import { Navigate, useNavigate, useParams } from 'react-router-dom';

import { notConnected } from '@/api/http';
import { ErrorState, Skeleton } from '@/components/feedback';
import { SettingsLayout } from '@/components/layout';
import { AvailabilitySection } from '@/features/doctor/appointments';
import { notificationCapabilities } from '@/features/doctor/notifications';
import { routes } from '@/routes';

import { useSettingsQuery } from '../api/useSettingsQueries';
import { SettingsNav } from '../components/SettingsNav';
import {
  SETTINGS_SECTIONS,
  isSettingsSection,
  type SettingsDocument,
  type SettingsSection,
} from '../model/types';
import { AboutSection } from '../sections/AboutSection';
import { AccessibilitySection } from '../sections/AccessibilitySection';
import { AccountSection } from '../sections/AccountSection';
import { ActivitySection } from '../sections/ActivitySection';
import { AppearanceSection } from '../sections/AppearanceSection';
import { IntegrationsSection } from '../sections/IntegrationsSection';
import { NotificationsSection } from '../sections/NotificationsSection';
import { PreferencesSection } from '../sections/PreferencesSection';
import { PrivacySection } from '../sections/PrivacySection';
import { ProfileSection } from '../sections/ProfileSection';
import { SecuritySection } from '../sections/SecuritySection';
import { VerificationSection } from '../sections/VerificationSection';

/**
 * Settings Center page — a full page of the app rather than a card on the
 * dashboard (`SettingsLayout`): a header band with the way back to the
 * Overview, the category navigation as a column of its own, and the active
 * section's grouped cards beside it. The active pane is the `:section` URL
 * param, so every section is deep-linkable and back/forward works.
 * Phase 19: the page is mount-point agnostic — `buildSectionPath` and
 * `backHref` let the admin Administration Center host the IDENTICAL
 * experience at its own URLs without duplicating any settings code.
 */
export interface SettingsPageProps {
  /** Maps a section id to its URL; defaults to the doctor workspace paths. */
  buildSectionPath?: (section: SettingsSection) => string;
  /** The dashboard home "Back to Overview" returns to; defaults to the doctor's. */
  backHref?: string;
  /**
   * The sections this workspace offers, in display order; all of them by
   * default. The staff workspaces (DEC-006a) pass `STAFF_SETTINGS_SECTIONS`:
   * a section outside the list is neither listed nor reachable by URL.
   */
  sections?: readonly SettingsSection[];
  /** Page heading; "Settings" by default. */
  title?: string;
  /** Line under the heading; the doctor/staff caption by default. */
  caption?: string;
}

const doctorSectionPath = (section: SettingsSection) => routes.doctor.settings(section);

export function SettingsPage({
  buildSectionPath = doctorSectionPath,
  backHref = routes.doctor.overview,
  sections,
  title = 'Settings',
  caption = 'Manage your profile, account, and workspace preferences.',
}: SettingsPageProps = {}) {
  const { section } = useParams<{ section: string }>();
  const navigate = useNavigate();
  const query = useSettingsQuery();

  const offered = sections ?? SETTINGS_SECTIONS.map((meta) => meta.id);
  const first = offered[0] ?? 'profile';
  if (section === undefined || !isSettingsSection(section) || !offered.includes(section)) {
    return <Navigate to={buildSectionPath(first)} replace />;
  }

  const meta = SETTINGS_SECTIONS.find((item) => item.id === section);

  return (
    <SettingsLayout
      title={title}
      caption={caption}
      backHref={backHref}
      backLabel="Back to Overview"
      navigation={
        <SettingsNav
          active={section}
          sections={offered}
          buildHref={buildSectionPath}
          onNavigateMobile={(next) => navigate(buildSectionPath(next))}
        />
      }
    >
      {/*
       * `h2`, not `h1` — the layout's header already renders the page's one
       * h1 ("Settings"), and this is the section within it. Two h1s told a
       * screen reader the page had changed identity on every section
       * navigation.
       *
       * Present at every width rather than `hidden lg:block`: below lg it is
       * visually hidden instead of absent, so the section a reader has
       * navigated into is still announced. The layout is unchanged —
       * `sr-only` takes the block out of flow.
       */}
      {meta ? (
        <div className="mb-5 max-lg:sr-only">
          <h2 className="text-h4 font-semibold text-text-primary">{meta.label}</h2>
          <p className="mt-0.5 text-body-sm text-text-secondary">{meta.description}</p>
        </div>
      ) : null}

      {query.isPending ? (
        <SectionSkeleton />
      ) : query.isError || !query.data ? (
        <ErrorState
          title="Couldn't load your settings"
          description="Something went wrong. Please try again."
          onRetry={() => void query.refetch()}
        />
      ) : (
        <SectionRouter
          section={section}
          document={query.data}
          onRetry={() => void query.refetch()}
        />
      )}
    </SettingsLayout>
  );
}

function SectionRouter({
  section,
  document,
  onRetry,
}: {
  section: SettingsSection;
  document: SettingsDocument;
  onRetry: () => void;
}) {
  switch (section) {
    case 'profile':
      return <ProfileSection />;
    case 'verification':
      return <VerificationSection />;
    case 'account':
      return <AccountSection document={document} />;
    case 'security':
      return <SecuritySection document={document} />;
    case 'privacy':
      return (
        <SettingsCenterGate document={document} area="Privacy preferences" onRetry={onRetry}>
          <PrivacySection document={document} />
        </SettingsCenterGate>
      );
    case 'notifications':
      return notificationCapabilities.preferences ? (
        <NotificationsSection />
      ) : (
        <NotConnectedSection area="Notification preferences" />
      );
    case 'availability':
      // Lazy (NEW-21): the editor carries the appointments service, which
      // no other Settings section needs. The skeleton is the one every
      // section shows while it loads, so this one looks no different.
      return (
        <Suspense fallback={<SectionSkeleton />}>
          <AvailabilitySection />
        </Suspense>
      );
    case 'appearance':
      return <AppearanceSection />;
    case 'preferences':
      return <PreferencesSection document={document} />;
    case 'accessibility':
      return <AccessibilitySection />;
    case 'integrations':
      return (
        <SettingsCenterGate document={document} area="Integrations" onRetry={onRetry}>
          <IntegrationsSection document={document} />
        </SettingsCenterGate>
      );
    case 'activity':
      return <ActivitySection document={document} />;
    case 'about':
      return <AboutSection />;
  }
}

/**
 * Privacy and Integrations live in the Settings Center (RM M22), which only
 * some servers keep: rendered when it answered, "not connected yet" when the
 * route is absent, and a failure with Retry when it exists and failed — the
 * rest of Settings is unaffected either way.
 */
function SettingsCenterGate({
  document,
  area,
  onRetry,
  children,
}: {
  document: SettingsDocument;
  area: string;
  onRetry: () => void;
  children: ReactNode;
}) {
  switch (document.settingsCenter) {
    case 'served':
      return children;
    case 'unserved':
      return <NotConnectedSection area={area} />;
    case 'failed':
      return (
        <ErrorState
          title={`Couldn't load ${area.toLowerCase()}`}
          description="The server did not answer. Your other settings are unaffected."
          onRetry={onRetry}
          headingLevel="h2"
        />
      );
  }
}

/**
 * A section the settings service keeps no record of (FE-10.9): said so,
 * rather than toggles that would look saved and be kept nowhere.
 */
function NotConnectedSection({ area }: { area: string }) {
  return <ErrorState error={notConnected(area)} headingLevel="h2" />;
}

function SectionSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      {[0, 1].map((i) => (
        <div key={i} className="rounded-surface border border-border bg-surface p-5">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="mt-2 h-3 w-64" />
          <div className="mt-5 flex flex-col gap-4">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}
