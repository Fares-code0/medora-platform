import { afterEach, describe, expect, it } from 'vitest';

import { clearUserPreferences } from '@/services/preferences';

import { clearAiSessionData, LEGACY_AI_STORAGE_KEYS } from './session-storage';
import { readConversations, readSettings, writeConversations, writeSettings } from './store';
import { DEFAULT_AI_SETTINGS } from './types';

/**
 * S1 — the store's own contract: conversations never touch browser storage,
 * settings live in the signed-in user's namespace, and the session clear
 * takes the legacy global keys with it. `AuthProvider.test.tsx` proves the
 * session paths call it.
 */

afterEach(() => {
  clearAiSessionData();
  window.localStorage.clear();
});

describe('the AI assistant store (S1)', () => {
  it('keeps conversations in memory, never in localStorage', () => {
    const seeded = readConversations();
    writeConversations([
      {
        id: 'conv-1',
        title: 'Current patient · Omar Saleh',
        context: { mode: 'patient', patientId: 'PT-1001', patientName: 'Omar Saleh', refId: null },
        messages: [],
        favorite: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      ...seeded,
    ]);

    expect(readConversations()[0]?.id).toBe('conv-1');
    expect(window.localStorage.length).toBe(0);
  });

  it('forgets the conversations when the session data is cleared', () => {
    writeConversations([]);
    expect(readConversations()).toHaveLength(0);

    clearAiSessionData();

    // The next read re-seeds the demo set; nothing of the old session remains.
    expect(readConversations().map((c) => c.id)).toStrictEqual([
      'conv-seed-metformin',
      'conv-seed-cbc',
    ]);
  });

  it('scopes settings per user, and keeps them over logout (F2)', () => {
    writeSettings({ ...DEFAULT_AI_SETTINGS, temperature: 0.9 }, 'user-a');
    window.localStorage.setItem('medora.user-a.sidebarCollapsed', 'true');

    expect(window.localStorage.getItem('medora.user-a.ai.settings.v1')).not.toBeNull();
    expect(readSettings('user-a').temperature).toBe(0.9);
    expect(readSettings('user-b')).toStrictEqual(DEFAULT_AI_SETTINGS);

    clearUserPreferences('user-a');

    // Kept, like a composed dashboard — while the rest of the namespace goes.
    expect(readSettings('user-a').temperature).toBe(0.9);
    expect(window.localStorage.getItem('medora.user-a.sidebarCollapsed')).toBeNull();
  });

  it('can never store free text — a patient name in any field is dropped', () => {
    writeSettings(
      {
        ...DEFAULT_AI_SETTINGS,
        favoritePromptIds: ['summarize-patient', 'Omar Saleh'],
        language: 'Omar Saleh' as never,
        responseLength: 'Omar Saleh' as never,
        temperature: 0.42,
        // An extra field a future change might add, or a tampered payload.
        note: 'Omar Saleh',
      } as never,
      'user-a',
    );

    const stored = window.localStorage.getItem('medora.user-a.ai.settings.v1') ?? '';
    expect(stored).not.toContain('Omar Saleh');
    expect(readSettings('user-a')).toStrictEqual({
      ...DEFAULT_AI_SETTINGS,
      favoritePromptIds: ['summarize-patient'],
    });
  });

  it('sanitizes what it reads, too — a planted payload carries nothing through', () => {
    window.localStorage.setItem(
      'medora.user-a.ai.settings.v1',
      JSON.stringify({ favoritePromptIds: ['Omar Saleh'], streaming: 'yes', patient: 'PT-1001' }),
    );

    const settings = readSettings('user-a');

    expect(JSON.stringify(settings)).not.toMatch(/Omar Saleh|PT-1001/);
    expect(settings).toStrictEqual({ ...DEFAULT_AI_SETTINGS, favoritePromptIds: [] });
  });

  it('writes nothing without a signed-in user', () => {
    writeSettings({ ...DEFAULT_AI_SETTINGS, temperature: 0.9 }, null);

    expect(window.localStorage.length).toBe(0);
    expect(readSettings(null)).toStrictEqual(DEFAULT_AI_SETTINGS);
  });

  it('removes the legacy global keys', () => {
    for (const key of LEGACY_AI_STORAGE_KEYS) window.localStorage.setItem(key, '"Omar Saleh"');

    clearAiSessionData();

    for (const key of LEGACY_AI_STORAGE_KEYS) {
      expect(window.localStorage.getItem(key)).toBeNull();
    }
  });
});
