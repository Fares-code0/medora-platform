import type { PrivacySettings, WorkflowPreferences } from './types';

/**
 * Production defaults for the two settings slices a live build fills in
 * itself (RM M40.4). They are not demo data: privacy is what the HTTP adapter
 * reports while the server's Settings Center is unavailable, and workflow is
 * the per-browser preference set before the doctor has chosen one
 * (`liveWorkflowStore`). They lived in `mock-data.ts` beside the seeded demo
 * doctor, and importing them from there kept that whole document in a
 * production bundle. The demo seed reuses them, so the two cannot drift.
 */

export const DEFAULT_PRIVACY: PrivacySettings = {
  dataSharing: true,
  analytics: true,
  cookies: true,
  aiDataUsage: false,
};

export const DEFAULT_WORKFLOW: WorkflowPreferences = {
  landingPage: 'overview',
  defaultPatientTab: 'summary',
  defaultRecordsTab: 'all',
  autoSaveDrafts: true,
  dateFormat: 'MM/DD/YYYY',
  timeFormat: '12h',
  timezone: 'America/Chicago',
};
