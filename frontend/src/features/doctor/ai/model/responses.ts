import type { AiConversationContext, AiResponseLength } from './types';

/**
 * Deterministic canned assistant responses — the "model" behind the mock
 * AI service. Responses are realistic clinical prose in Markdown (the
 * chat renders headings, lists, tables, and code blocks) and are selected
 * by suggested-prompt id or context mode, then trimmed to the configured
 * response length. Deleted with the mock layer when a real assistant API
 * lands.
 */

const DISCLAIMER =
  '\n\n---\n*Medora AI supports, but never replaces, clinical judgment. Verify before acting; ' +
  'this mock response is generated from seeded demo data.*';

function subject(context: AiConversationContext): string {
  return context.patientName ?? 'this patient';
}

function ref(context: AiConversationContext): string {
  return context.refId ?? 'the attached document';
}

/* ── Response bodies (arrays of markdown sections) ──────────────── */

function summarizePatient(context: AiConversationContext): readonly string[] {
  const name = subject(context);
  return [
    `## Clinical summary — ${name}\n\n${name} is an adult patient followed in General Medicine with **type 2 diabetes** and **essential hypertension**, currently under active treatment and moderate cardiovascular risk.`,
    `### Active problems\n- Type 2 diabetes mellitus (E11.9) — last HbA1c trending above target\n- Essential hypertension (I10) — home readings borderline\n- Recurrent low back pain, mechanical pattern`,
    `### Current medications\n| Medication | Dose | Schedule |\n| --- | --- | --- |\n| Metformin | 500 mg | Twice daily |\n| Lisinopril | 10 mg | Once daily |\n| Atorvastatin | 20 mg | At night |`,
    `### Risks & gaps\n- **Allergy on file** — verify before prescribing beta-lactams.\n- Annual retinal screening not documented in the last 12 months.\n- Consider renal function review before the next metformin refill.`,
  ];
}

function explainLabs(context: AiConversationContext): readonly string[] {
  return [
    `## Interpretation — ${ref(context)}\n\nOverall the panel is **mostly within reference ranges**, with two values that deserve attention.`,
    `### Flagged values\n| Analyte | Result | Reference | Flag |\n| --- | --- | --- | --- |\n| Sodium | 166 mmol/L | 135–145 | Critical high |\n| Potassium | 3.2 mmol/L | 3.5–5.1 | Low |\n\nSevere hypernatremia of this degree is most often a water-deficit state (dehydration, diabetes insipidus, impaired thirst). The mild hypokalemia may share the same cause.`,
    `### Suggested next steps\n1. Repeat the sample to exclude a pre-analytical artifact (the specimen was flagged *hemolyzed*).\n2. Assess volume status and free-water access; review diuretics.\n3. If confirmed, correct the free-water deficit gradually — rapid correction risks cerebral edema:\n\n\`\`\`js\n// Free-water deficit (L) — illustrative calculation\nconst weightKg = 70;\nconst sodium = 166;\nconst deficit = 0.6 * weightKg * (sodium / 140 - 1);\n// ≈ 7.8 L, replaced over 48–72 h\n\`\`\``,
  ];
}

function drugInteractions(context: AiConversationContext): readonly string[] {
  return [
    `## Interaction screen — ${subject(context)}\n\nScreened the active medication list pairwise. **One major and one moderate interaction** found.`,
    `### Findings\n| Severity | Pair | Mechanism |\n| --- | --- | --- |\n| **Major** | Warfarin + Ibuprofen | Additive bleeding risk, platelet inhibition + INR elevation |\n| Moderate | Omeprazole + Clopidogrel | Reduced CYP2C19 activation of clopidogrel |`,
    `### Recommendations\n- Replace ibuprofen with paracetamol for analgesia while on warfarin.\n- If PPI cover is needed, pantoprazole has the weakest CYP2C19 signal.\n- Recheck INR within one week of any regimen change.`,
  ];
}

function differential(context: AiConversationContext): readonly string[] {
  return [
    `## Differential diagnosis — ${ref(context)}\n\nBased on the documented presentation (exertional chest tightness relieved by rest), ranked by pre-test probability:`,
    `1. **Stable angina pectoris** — classic exertional pattern, cardiovascular risk factors present.\n2. **Gastro-esophageal reflux** — postprandial component reported; often coexists.\n3. **Musculoskeletal chest pain** — reproducible tenderness would support this.\n4. Anxiety-related chest discomfort — consider only after organic causes.`,
    `### Suggested workup\n- Resting ECG and troponin if symptoms are recent or accelerating.\n- Consider a functional test (stress echo) if intermediate probability.\n- Trial of PPI only after ischemia is reasonably excluded.`,
  ];
}

function reviewMedications(context: AiConversationContext): readonly string[] {
  return [
    `## Medication review — ${subject(context)}\n\nRegimen is broadly appropriate; three optimization opportunities stand out.`,
    `### Observations\n- **Duplication** — two agents from the same class appear active; confirm one was meant to stop.\n- **Renal dosing** — metformin needs an eGFR check before the next 90-day refill.\n- **Deprescribing** — long-term PPI without a documented indication; consider a step-down trial.`,
    `### Monitoring\n- INR weekly until stable if anticoagulated.\n- Annual HbA1c, lipids, and renal panel are due within the next quarter.`,
  ];
}

function explainImaging(context: AiConversationContext): readonly string[] {
  return [
    `## Imaging findings — ${ref(context)}\n\nThe report describes **mild degenerative changes** without acute abnormality.`,
    `### Key findings\n- Disc space narrowing at L4–L5 with small marginal osteophytes.\n- No fracture, lytic lesion, or spondylolisthesis.\n- Soft tissues unremarkable.`,
    `### What this means\nFindings are common age-related changes and correlate with mechanical back pain. Red-flag review is negative; imaging follow-up is only warranted if neurology changes.`,
  ];
}

function generalAnswer(prompt: string): readonly string[] {
  const topic = prompt.trim().replace(/\s+/g, ' ').slice(0, 80);
  return [
    `## On “${topic}”\n\nHere is a structured overview based on standard clinical references.`,
    `### Key points\n- Definition and typical presentation, with the findings that most change management.\n- First-line assessment: focused history, examination, and only targeted investigations.\n- Evidence-based initial management, and the thresholds for escalation or referral.`,
    `### Cautions\n- Individualize for comorbidity, renal/hepatic function, and current medications.\n- Safety-net: advise urgent review if red-flag features appear.`,
  ];
}

/* ── Selection & length shaping ─────────────────────────────────── */

const PROMPT_BUILDERS: Record<string, (c: AiConversationContext) => readonly string[]> = {
  'summarize-patient': summarizePatient,
  'explain-labs': explainLabs,
  'drug-interactions': drugInteractions,
  'differential-diagnosis': differential,
  'review-medications': reviewMedications,
  'explain-imaging': explainImaging,
};

const MODE_BUILDERS: Record<string, (c: AiConversationContext) => readonly string[]> = {
  patient: summarizePatient,
  labs: explainLabs,
  pharmacy: drugInteractions,
  record: differential,
};

const SECTIONS_BY_LENGTH: Record<AiResponseLength, number> = {
  concise: 2,
  balanced: 3,
  detailed: 4,
};

export function buildAssistantResponse(input: {
  readonly prompt: string;
  readonly promptId: string | null;
  readonly context: AiConversationContext;
  readonly responseLength: AiResponseLength;
}): string {
  const builder =
    (input.promptId !== null ? PROMPT_BUILDERS[input.promptId] : undefined) ??
    MODE_BUILDERS[input.context.mode] ??
    (() => generalAnswer(input.prompt));

  const sections = builder(input.context);
  const kept = sections.slice(0, Math.max(1, SECTIONS_BY_LENGTH[input.responseLength]));
  return kept.join('\n\n') + DISCLAIMER;
}

/** Greeting seeded into a conversation opened from a contextual entry point. */
export function buildContextGreeting(context: AiConversationContext): string {
  const where = contextSentence(context);
  return (
    `Hi — I’ve loaded ${where} as context for this chat. Ask me anything about it, ` +
    `or pick a suggested prompt below.${DISCLAIMER}`
  );
}

function contextSentence(context: AiConversationContext): string {
  const name = context.patientName ? `**${context.patientName}**` : 'the selected patient';
  switch (context.mode) {
    case 'patient':
      return `${name}’s profile`;
    case 'record':
      return `medical record **${ref(context)}** for ${name}`;
    case 'labs':
      return `laboratory order **${ref(context)}** for ${name}`;
    case 'pharmacy':
      return `prescription **${ref(context)}** for ${name}`;
    default:
      return 'no specific clinical context';
  }
}
