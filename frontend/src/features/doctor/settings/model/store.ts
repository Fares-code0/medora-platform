import { selectService } from '@/api/seam';

import { DEFAULT_WORKFLOW } from './defaults';
import { SEED_SETTINGS } from './mock-data';
import type { SettingsDocument, WorkflowPreferences } from './types';

/**
 * Local persistence for the settings document — seeded on first run, then
 * mutated by the mock service. Persisted per user under the
 * `medora.<userId>.` prefix so the auth provider's `clearUserPreferences`
 * wipes it on logout (§6.4), same as the notifications preferences. Reads
 * are defensive: each top-level branch is merged over the seed so a stale
 * or malformed payload can never crash the page. This module is the
 * feature's single `window.localStorage` boundary. No PHI.
 */

const VERSION = 'v1';

let idCounter = 0;

/** Unique-enough id for locally created entities (activity entries, …). */
export function localId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${String(idCounter)}`;
}

function storageKey(userId: string): string {
  return `medora.${userId}.settings.${VERSION}`;
}

function mergeWithSeed(partial: Partial<SettingsDocument>): SettingsDocument {
  return {
    account: { ...SEED_SETTINGS.account, ...partial.account },
    security: { ...SEED_SETTINGS.security, ...partial.security },
    privacy: { ...SEED_SETTINGS.privacy, ...partial.privacy },
    workflow: { ...SEED_SETTINGS.workflow, ...partial.workflow },
    integrations: Array.isArray(partial.integrations)
      ? partial.integrations
      : SEED_SETTINGS.integrations,
    activity: Array.isArray(partial.activity) ? partial.activity : SEED_SETTINGS.activity,
    // This browser keeps both sections in the demo, whatever an older
    // stored copy of the document said.
    settingsCenter: 'served',
  };
}

export function readSettings(userId: string): SettingsDocument {
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (raw === null) {
      writeSettings(userId, SEED_SETTINGS);
      return SEED_SETTINGS;
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return SEED_SETTINGS;
    return mergeWithSeed(parsed);
  } catch {
    return SEED_SETTINGS;
  }
}

export function writeSettings(userId: string, document: SettingsDocument): void {
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(document));
  } catch {
    // Storage unavailable/full — the session keeps working in memory.
  }
}

/* ── Workflow preferences ───────────────────────────────────────── */

const WORKFLOW_VERSION = 'v1';

function workflowKey(userId: string): string {
  return `medora.${userId}.workflow.${WORKFLOW_VERSION}`;
}

/**
 * Where the workflow preferences (landing page, formats, timezone) live.
 *
 * They are this browser's preferences in both modes. Mock mode keeps them
 * inside the demo settings document; live (FE-10.9) keeps **only** them,
 * under their own key — the demo document carries demo sessions, devices
 * and a demo password, none of which may be written into a real doctor's
 * browser.
 */
interface WorkflowStore {
  readonly read: (userId: string) => WorkflowPreferences;
  readonly write: (userId: string, workflow: WorkflowPreferences) => void;
}

/** Live: the preferences alone, under their own key. The HTTP adapter uses this directly. */
export const liveWorkflowStore: WorkflowStore = {
  read: (userId) => {
    try {
      const raw = window.localStorage.getItem(workflowKey(userId));
      if (raw === null) return DEFAULT_WORKFLOW;
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) return DEFAULT_WORKFLOW;
      return { ...DEFAULT_WORKFLOW, ...(parsed as Partial<WorkflowPreferences>) };
    } catch {
      return DEFAULT_WORKFLOW;
    }
  },
  write: (userId, workflow) => {
    try {
      window.localStorage.setItem(workflowKey(userId), JSON.stringify(workflow));
    } catch {
      // Storage unavailable — the preference holds for this session only.
    }
  },
};

export const workflowStore: WorkflowStore = selectService<WorkflowStore>({
  mock: {
    read: (userId) => readSettings(userId).workflow,
    write: (userId, workflow) => writeSettings(userId, { ...readSettings(userId), workflow }),
  },
  http: liveWorkflowStore,
});
