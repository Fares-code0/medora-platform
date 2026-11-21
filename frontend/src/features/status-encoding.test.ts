import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { STATUS_PRESENTATION, type StatusKind } from '@/components/patterns';
import { resolveToken } from '@/test/tokens';

import { PRESENCE_KIND, ROOM_STATUS_KIND } from './admin/administration.meta';
import {
  DELIVERY_KIND,
  STATUS_KIND as OVERSIGHT_STATUS_KIND,
} from './admin/appointments/oversight';
import { ACCOUNT_KIND, DOCUMENT_DECISION_KIND, LOGIN_RESULT_KIND, VERIFICATION_KIND } from './admin/doctors/doctors';
import {
  APPOINTMENT_PRIORITY_META,
  APPOINTMENT_STATUS_META,
} from './doctor/appointments/model/types';
import { LAB_REVIEW_META } from './doctor/labs/model/review';
import { LAB_PRIORITY_META, LAB_STATUS_META } from './doctor/labs/model/types';
import { RECORD_PRIORITY_META, RECORD_STATUS_META } from './doctor/medical-records/model/types';
import { PRESCRIPTION_STATUS_META, REFILL_STATUS_META } from './doctor/pharmacy/model/types';
import { PATIENT_STATUS_META, RISK_LEVEL_META } from './shared-domain/patient-identity/types';

/**
 * Status encoding invariants — ADR-0001 §12 (Wave 2b).
 *
 * The acceptance criterion is CONTEXTUAL, not global:
 *
 *   Distinct meanings that can co-occur in the same visual context must be
 *   distinguishable at scan speed.
 *
 * Global uniqueness across all fourteen kinds is explicitly NOT required —
 * `confirmed` and `active` are allowed to look identical because no surface
 * renders both, and buying uniqueness there would put chrome on the two most
 * common badges on the platform for no scanning benefit.
 *
 * "At scan speed" means the encoding differs, not merely the label. A reader
 * sweeping a status column bins by treatment before reading, so two kinds
 * separated only by their text are two kinds that get grouped wrongly.
 */

const SRC = join(__dirname, '..');

/** The encoding a reader can actually see, independent of the label. */
function treatment(kind: StatusKind): string {
  const p = STATUS_PRESENTATION[kind];
  return `${p.variant}/${p.emphasis}/${p.icon ? p.icon.displayName ?? p.icon.name : 'dot'}`;
}

function kindsOf(meta: Record<string, { readonly kind: StatusKind }>): StatusKind[] {
  return Object.values(meta).map((m) => m.kind);
}

/**
 * Every place two or more kinds render together — one column, or adjacent
 * columns in one row. Cross-SCREEN pairs are deliberately absent: they cannot
 * be compared at a glance, so they cannot be confused at a glance.
 */
const CONTEXTS: readonly { name: string; kinds: readonly StatusKind[] }[] = [
  { name: 'Appointments · Status column', kinds: kindsOf(APPOINTMENT_STATUS_META) },
  {
    name: 'Appointments · Status ∥ Priority',
    kinds: [...kindsOf(APPOINTMENT_STATUS_META), ...kindsOf(APPOINTMENT_PRIORITY_META)],
  },
  { name: 'Labs · Status ∥ Priority', kinds: [...kindsOf(LAB_STATUS_META), ...kindsOf(LAB_PRIORITY_META)] },
  {
    /*
     * D-10 added the review column, so the labs row now renders three
     * lifecycles side by side. Only `unreviewed` takes a kind — `reviewed`
     * and `not-required` render as text, so the row gains exactly one badge
     * treatment to keep separable rather than three.
     */
    name: 'Labs · Status ∥ Priority ∥ Review',
    kinds: [
      ...kindsOf(LAB_STATUS_META),
      ...kindsOf(LAB_PRIORITY_META),
      ...Object.values(LAB_REVIEW_META)
        .map((meta) => meta.kind)
        .filter((kind): kind is StatusKind => kind !== null),
    ],
  },
  { name: 'Records · Status column', kinds: kindsOf(RECORD_STATUS_META) },
  {
    name: 'Records · Status ∥ Priority',
    kinds: [...kindsOf(RECORD_STATUS_META), ...kindsOf(RECORD_PRIORITY_META)],
  },
  { name: 'Prescriptions · Status column', kinds: kindsOf(PRESCRIPTION_STATUS_META) },
  { name: 'Pharmacy · Status ∥ Refill', kinds: [...kindsOf(PRESCRIPTION_STATUS_META), ...kindsOf(REFILL_STATUS_META)] },
  { name: 'Patients · Status ∥ Risk', kinds: [...kindsOf(PATIENT_STATUS_META), ...kindsOf(RISK_LEVEL_META)] },

  /* Admin lifecycles migrated in Wave 2b. Each is one column of one table. */
  {
    name: 'Admin · Staff presence',
    kinds: Object.values(PRESENCE_KIND),
  },
  {
    name: 'Admin · Room status',
    kinds: Object.values(ROOM_STATUS_KIND),
  },
  {
    name: 'Admin · Notification delivery',
    kinds: Object.values(DELIVERY_KIND),
  },
  {
    name: 'Admin · Document decision',
    kinds: Object.values(DOCUMENT_DECISION_KIND),
  },
  {
    name: 'Admin · Login result',
    kinds: Object.values(LOGIN_RESULT_KIND),
  },
  {
    name: 'Admin · Doctor verification ∥ account',
    kinds: [...Object.values(VERIFICATION_KIND), ...Object.values(ACCOUNT_KIND)],
  },
  {
    name: 'Admin · Appointment oversight status',
    kinds: Object.values(OVERSIGHT_STATUS_KIND),
  },
];

/*
 * Class-B collisions: two DOMAIN values collapsing onto one StatusKind. The
 * Badge cannot see these — by the time a kind is chosen the distinction is
 * already gone — so they are excluded here and tracked as domain debt rather
 * than silently passing as if the encoding had solved them.
 */
const KNOWN_CLASS_B: readonly string[] = [
  'lab flags Low/High/Abnormal all map to `expiring`',
  'lab flags Critical-low/Critical-high both map to `critical`',
  'risk High/Critical both map to `critical`',
  'appointment Scheduled/Rescheduled both map to `scheduled`',
];

describe('contextual scan-speed separability', () => {
  it.each(CONTEXTS)('$name renders no two kinds identically', ({ kinds }) => {
    const distinct = [...new Set(kinds)];
    const byTreatment = new Map<string, StatusKind[]>();
    for (const kind of distinct) {
      const t = treatment(kind);
      byTreatment.set(t, [...(byTreatment.get(t) ?? []), kind]);
    }
    const collisions = [...byTreatment.entries()].filter(([, ks]) => ks.length > 1);
    expect(collisions.map(([t, ks]) => `${ks.join(' + ')} → ${t}`)).toEqual([]);
  });

  it('does NOT require global uniqueness — confirmed and active may share a treatment', () => {
    expect(treatment('confirmed')).toBe(treatment('active'));
    const together = CONTEXTS.filter(
      (c) => c.kinds.includes('confirmed') && c.kinds.includes('active'),
    );
    // The sharing is only acceptable while nothing renders both.
    expect(together).toEqual([]);
  });

  it('records the Class-B collisions the encoding cannot reach', () => {
    expect(KNOWN_CLASS_B).toHaveLength(4);
  });
});

describe('DEBT-2b-01 — the lifecycle/severity boundary', () => {
  /**
   * `expiring` means literal time expiry and nothing else. It became the
   * platform's de-facto "medium severity" because it was the only spare
   * amber, which is why it carries no glyph: an AlarmClock would be wrong
   * wherever it stands in for High, Moderate, Important, Medium or Urgent.
   *
   * Severity is an ORDINAL RAMP (low → critical); lifecycle is a set of
   * states a thing moves between. They are different shapes, and a severity
   * ramp squeezed into lifecycle kinds loses its ordering. Until a real
   * severity vocabulary exists, the severity-shaped maps stay on
   * `BadgeVariant` — deliberately, not by omission.
   */
  const SEVERITY_SHAPED = [
    ['admin/logs/logs', 'SEVERITY_VARIANT'],
    ['admin/overview/overview', 'ALERT_SEVERITY_VARIANT'],
    ['admin/administration.meta', 'QUEUE_PRIORITY_VARIANT'],
    ['admin/administration.meta', 'ANNOUNCEMENT_PRIORITY_VARIANT'],
    ['admin/administration.meta', 'RESOURCE_STATUS_VARIANT'],
  ] as const;

  it.each(SEVERITY_SHAPED)('%s keeps %s on BadgeVariant, not StatusKind', (mod, name) => {
    const src = readFileSync(join(SRC, 'features', `${mod}.ts`), 'utf8');
    expect(src).toMatch(new RegExp(`${name}:\\s*Record<[^>]*,\\s*BadgeVariant>`));
    expect(src).not.toMatch(new RegExp(`${name.replace('_VARIANT', '_KIND')}\\s*:`));
  });

  it('never routes a severity ramp through `expiring`', () => {
    // The guard is the boundary itself: no severity map may name a StatusKind.
    for (const [mod, name] of SEVERITY_SHAPED) {
      const src = readFileSync(join(SRC, 'features', `${mod}.ts`), 'utf8');
      const body = src.split(`${name}:`)[1]?.split('};')[0] ?? '';
      expect(body, `${name} reaches for a lifecycle kind`).not.toContain("'expiring'");
    }
  });

  it('leaves `expiring` glyphless while it is still overloaded', () => {
    expect(STATUS_PRESENTATION.expiring.icon).toBeUndefined();
    expect(STATUS_PRESENTATION.expiring.emphasis).toBe('filled');
    // `pending` carries the Clock, so the pair still separates by glyph
    // presence wherever both render.
    expect(STATUS_PRESENTATION.pending.icon).toBeDefined();
  });
});

describe('StatusKind → hue / emphasis / glyph mapping', () => {
  it('is exactly the approved map', () => {
    const rows = Object.fromEntries(
      (Object.keys(STATUS_PRESENTATION) as StatusKind[]).map((k) => [k, treatment(k)]),
    );
    expect(rows).toEqual({
      confirmed: 'success/filled/dot',
      active: 'success/filled/dot',
      normal: 'success/outline/dot',
      pending: 'warning/filled/Clock',
      awaiting: 'warning/outline/dot',
      expiring: 'warning/filled/dot',
      critical: 'error/filled/dot',
      cancelled: 'error/outline/Ban',
      rejected: 'error/outline/UserRoundX',
      scheduled: 'info/filled/dot',
      info: 'info/outline/dot',
      completed: 'neutral/outline/CheckCheck',
      archived: 'neutral/outline/Archive',
      ai: 'ai/filled/Sparkles',
    });
  });

  it('keeps `ai` off the lifecycle axis — it is the only kind on the accent hue', () => {
    const accent = (Object.keys(STATUS_PRESENTATION) as StatusKind[]).filter(
      (k) => STATUS_PRESENTATION[k].variant === 'ai',
    );
    expect(accent).toEqual(['ai']);
  });

  it('does not paint `completed` as live to win a collision', () => {
    // Finished is finished: the glyph separates it from `archived`, not a
    // semantic bend to filled.
    expect(STATUS_PRESENTATION.completed.emphasis).toBe('outline');
    expect(STATUS_PRESENTATION.archived.emphasis).toBe('outline');
  });
});

describe('Badge emphasis validity', () => {
  const badge = readFileSync(join(SRC, 'components/ui/Badge.tsx'), 'utf8');
  const VARIANTS = ['success', 'warning', 'error', 'info', 'neutral', 'ai'];

  it('defines both emphases for every variant', () => {
    for (const table of ['FILLED', 'OUTLINE']) {
      const body = badge.split(`const ${table}: Record<BadgeVariant, string> = {`)[1]?.split('};')[0];
      expect(body, `${table} table missing`).toBeDefined();
      for (const v of VARIANTS) expect(body).toContain(`${v}:`);
    }
  });

  it('outlines with an inset ring, so the box geometry never changes', () => {
    const outline = badge.split('const OUTLINE')[1]?.split('};')[0] ?? '';
    expect(outline).toContain('ring-1 ring-inset');
    // A `border` utility would add 2px to the box and eat a pixel of padding
    // on every side. `ring-border-strong` is a ring COLOUR, not a border.
    expect(outline).not.toMatch(/(?<!ring-)\bborder\b/);
  });

  it('never lets a status badge carry a dot and a glyph at once', () => {
    // Enforced in the type (BadgeGlyph union); asserted here so a widening of
    // that union does not pass unnoticed.
    expect(badge).toContain('type BadgeGlyph');
    for (const kind of Object.keys(STATUS_PRESENTATION) as StatusKind[]) {
      const p = STATUS_PRESENTATION[kind];
      expect(typeof p.icon === 'function' ? 'icon' : 'dot').toBeTruthy();
    }
  });
});

describe('outline border contrast, both themes', () => {
  /** Resolved through the palette references — see test/tokens.ts. */
  function tokensFor(theme: 'light' | 'dark'): Record<string, string> {
    const out: Record<string, string> = {};
    for (const name of [...Object.values(RING), 'border', 'surface', 'surface-sunken']) {
      out[name] = resolveToken(`color-${name}`, theme);
    }
    return out;
  }

  const lum = (hex: string): number => {
    const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const f = (c: number): number => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(ch[0] as number) + 0.7152 * f(ch[1] as number) + 0.0722 * f(ch[2] as number);
  };
  const ratio = (a: string, b: string): number => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
    return (x + 0.05) / (y + 0.05);
  };

  /** The ring colour each outline variant actually paints. */
  const RING: Record<string, string> = {
    success: 'success',
    warning: 'warning',
    error: 'error',
    info: 'info',
    ai: 'accent',
    neutral: 'border-strong',
  };

  it.each(['light', 'dark'] as const)(
    '%s: every outline ring clears 3:1 on surface AND on sunken rows',
    (theme) => {
      const t = tokensFor(theme);
      const failures: string[] = [];
      for (const [variant, token] of Object.entries(RING)) {
        const ring = t[token];
        for (const bg of ['surface', 'surface-sunken']) {
          const r = ratio(ring as string, t[bg] as string);
          if (r < 3) failures.push(`${variant} on ${bg}: ${r.toFixed(2)}:1`);
        }
      }
      expect(failures).toEqual([]);
    },
  );

  it.each(['light', 'dark'] as const)('%s: --color-border is NOT used as an outline ring', (theme) => {
    // Measured at 1.27–1.57:1. It is the container edge, and it cannot carry
    // a boundary that means something (WCAG 1.4.11).
    const t = tokensFor(theme);
    expect(ratio(t['border'] as string, t['surface'] as string)).toBeLessThan(3);
    const badge = readFileSync(join(SRC, 'components/ui/Badge.tsx'), 'utf8');
    const outline = badge.split('const OUTLINE')[1]?.split('};')[0] ?? '';
    expect(outline).not.toContain('ring-border ');
  });
});

/* ── Source-scanning guards ───────────────────────────────────── */

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(p));
    else if (/\.tsx?$/.test(entry.name) && !entry.name.includes('.test.')) out.push(p);
  }
  return out;
}

describe('AI provenance is never spent as a decorative hue', () => {
  /**
   * `ai` marks machine-generated content (ADR-0001 §6). Every use of it as a
   * sixth taxonomy colour dilutes the one signal that tells a clinician a
   * value was not written by a person. Five such uses existed before 2b:
   * a clinic holiday, a document-template kind, an evening shift, a
   * rescheduled appointment, and a patient complaint.
   */
  /**
   * The guard targets the defect CLASS, not the literal string. A hand-written
   * `variant="ai"` on an AI surface — the assistant launcher, an AI quick
   * action, the AI dashboard — is the token doing its job, and nine such sites
   * are correct. The misuse was always the same shape: a domain value map
   * typed `BadgeVariant` reaching for `'ai'` as a sixth taxonomy hue, which is
   * how an evening shift, a rescheduled appointment and a patient complaint
   * ended up wearing the provenance violet.
   */
  it('has no domain→BadgeVariant map that resolves to `ai`', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const rel = file.slice(SRC.length + 1).replace(/\\/g, '/');
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/Record<[^>]*,\s*BadgeVariant>\s*=\s*\{([\s\S]*?)\n\}/g)) {
        for (const hit of (m[1] ?? '').matchAll(/^\s*([\w'"-]+):\s*'ai'/gm)) {
          offenders.push(`${rel} → ${hit[1] ?? ''}: 'ai'`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the two literal misuse sites corrected', () => {
    const holidays = readFileSync(join(SRC, 'features/admin/sections/HolidaysSection.tsx'), 'utf8');
    expect(holidays).not.toMatch(/holiday\.kind === 'public' \? 'info' : 'ai'/);

    const templates = readFileSync(join(SRC, 'features/admin/sections/TemplatesSection.tsx'), 'utf8');
    // The same KIND_LABEL renders neutral on the card; the preview matches it.
    expect(templates).not.toMatch(/<Badge variant="ai">\{KIND_LABEL/);
  });
});

describe('Pharmacy High-risk stays distinct from the amber lifecycle statuses', () => {
  /**
   * High-risk is an ATTRIBUTE of the drug, not a lifecycle state, so it must
   * not become a StatusKind. But it shares a row with Pending approval and
   * Due, which are both amber — three amber marks meaning three different
   * things. It keeps the caution hue and separates by emphasis + glyph.
   */
  const files = [
    'features/doctor/pharmacy/components/PharmacyCells.tsx',
    'features/doctor/pharmacy/components/detail/MedicationDetailsSection.tsx',
  ];

  it.each(files)('%s renders High-risk as an outlined, glyphed attribute', (rel) => {
    const src = readFileSync(join(SRC, rel), 'utf8');
    const block = src.slice(src.indexOf('isHighRisk ?'), src.indexOf('isHighRisk ?') + 240);
    expect(block).toContain('emphasis="outline"');
    expect(block).toContain('TriangleAlert');
  });

  it('is not reachable through StatusKind', () => {
    const kinds = Object.keys(STATUS_PRESENTATION);
    expect(kinds).not.toContain('high-risk');
  });

  it('differs from every amber status that shares its row', () => {
    const rowAmber = [...kindsOf(PRESCRIPTION_STATUS_META), ...kindsOf(REFILL_STATUS_META)]
      .filter((k) => STATUS_PRESENTATION[k].variant === 'warning')
      .map(treatment);
    // warning + outline + TriangleAlert is what High-risk paints.
    expect(rowAmber).not.toContain('warning/outline/TriangleAlert');
  });
});

describe('non-status direct Badge consumers are untouched', () => {
  /**
   * The 2b migration moved the ~41 sites whose badge expresses an entity's
   * lifecycle. Taxonomy chips, attribute markers, counts and static warnings
   * are NOT statuses and must keep rendering as plain `Badge` — a broad
   * mechanical sweep would have encoded a lifecycle claim they do not make.
   */
  const KEEP_DIRECT = [
    ['features/admin/logs/LogTable.tsx', 'ACTOR_ROLE_LABEL'],
    ['features/admin/patients/AccessGrid.tsx', 'SCOPE_LABEL'],
    ['features/admin/sections/PoliciesSection.tsx', 'policy.version'],
    ['features/doctor/labs/components/LabCells.tsx', 'test.category'],
    ['features/doctor/appointments/components/AppointmentCells.tsx', 'New'],
    ['features/doctor/medical-records/components/detail/RecordDiagnosesSection.tsx', 'Primary'],
  ] as const;

  /*
   * Scoped to the ELEMENT that renders the marker, not the file. Several of
   * these files legitimately render both — a status badge for the row's
   * lifecycle and a plain chip for a taxonomy value beside it — so a
   * file-wide assertion would be testing the wrong thing.
   */
  function spans(src: string, tag: string): string[] {
    const out: string[] = [];
    const open = `<${tag}`;
    for (let i = src.indexOf(open); i !== -1; i = src.indexOf(open, i + 1)) {
      // Reject `<Badge` matching inside `<BadgeSomething`.
      if (/[A-Za-z]/.test(src[i + open.length] ?? '')) continue;
      const close = src.indexOf(`</${tag}>`, i);
      const selfClose = src.indexOf('/>', i);
      const end =
        close !== -1 && (selfClose === -1 || close < selfClose) ? close : (selfClose === -1 ? src.length : selfClose);
      out.push(src.slice(i, end));
    }
    return out;
  }

  it.each(KEEP_DIRECT)('%s still renders %s inside a plain <Badge>', (rel, marker) => {
    const src = readFileSync(join(SRC, rel), 'utf8');
    expect(spans(src, 'Badge').some((s) => s.includes(marker))).toBe(true);
    expect(spans(src, 'StatusBadge').some((s) => s.includes(marker))).toBe(false);
  });

  it('leaves counts and deltas on CountBadge / plain Badge', () => {
    const src = readFileSync(join(SRC, 'components/patterns/StatisticCard.tsx'), 'utf8');
    expect(src).toContain('<Badge');
    expect(src).not.toContain('<StatusBadge');
  });
});
