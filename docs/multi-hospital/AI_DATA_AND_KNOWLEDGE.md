# Multi-Hospital — Patient AI Agent: Data and Knowledge

**Owner team:** AI, with a named clinical reviewer (OPEN, KD-9)
**Checklist:** [`AI_CHECKLIST.md`](AI_CHECKLIST.md) phase AG-2
**Governing decisions (FINAL):** DR-12 (no raw retention, no training on cross-hospital data),
DR-13 (assistant-not-doctor governance), OD-10 (discovery data), OD-14 (insurance)
**Status:** PROPOSED. No corpus, index or dataset exists (AF-27). No source has been licensed or
reviewed.

This file covers the **patient** agent. Doctor-side retention classes C1, C2 and C3 stay as defined in
`AI_CHECKLIST.md` §1 and are not changed here.

---

## 1. Data categories, kept separate

| # | Category | Source of truth | May enter the model context | May be persisted by the AI layer | Never |
|---|---|---|---|---|---|
| K1 | **Trusted medical knowledge**: general, educational, non-personal | The curated corpus (§2) | Yes, as retrieved passages with citations | Yes, as the versioned corpus and index | Unreviewed web text; model "memory" presented as fact |
| K2 | **Live discovery and scheduling data**: hospitals, doctors, specialties, slots, ratings, insurance acceptance | Application APIs only (`AI_TOOLING_AND_BOOKING.md`) | Yes, fetched per turn through tools | **No**, apart from ids inside the conversation's tool-result turns (§4) | Copied into the knowledge index; cached across users; used for training |
| K3 | **Patient-specific data**: own appointments; the patient's own typed messages | Application APIs after authentication and self-scope | Yes, for that patient's own conversation only | The conversation (retention per KD-6) | Shared across patients; used for training; written to logs; visible to staff by default |
| K4 | **Evaluation datasets** | `AI_EVALUATION_AND_TESTING.md` | In eval runs only | Yes, versioned in the repository | Real patient data; synthetic records presented as clinical fact |
| K5 | **Fine-tuning datasets** | None (§6) | — | — | Created without a documented justification and owner approval |

Hospital-confidential data (staff, rooms, internal notes, working hours that are not published slots)
is **not** reachable by any patient tool and never enters K1.

---

## 2. Trusted medical knowledge (K1) and the RAG pipeline

### 2.1 Why retrieval and not model knowledge

Patient-facing medical statements must be traceable to a reviewed source. Retrieval gives the
following, and unaided model output gives none of them:

- a citation the patient can open;
- a reviewer and review date for every passage;
- a way to correct content without retraining;
- a measurable recall.

### 2.2 Source selection: candidates only, none approved

| Candidate | Language | What must be verified before use (AG-2.3) |
|---|---|---|
| U.S. National Library of Medicine, MedlinePlus health topics | English (some other languages) | Which pages are NLM-authored and reusable, and which are licensed third-party content that is **not** reusable. Attribution terms |
| World Health Organization fact sheets | English, Arabic (WHO publishes in Arabic) | The licence of each document (WHO commonly uses CC BY-NC-SA 3.0 IGO; verify per item). Whether non-commercial terms fit the project's use. Adaptation rules for excerpts |
| Ministry of Health patient-education material for the deployment country | Arabic | Copyright and permission to reuse. Currency |
| Medora-authored navigation content ("which specialist handles…", "how booking works") | Arabic, English | Written by the team and **clinically reviewed** before inclusion |

No source enters the corpus until its row in the source register (§2.3) shows a verified licence, a
reviewer and a review date. A source whose licence cannot be verified is excluded. It is not
paraphrased around.

### 2.3 Provenance: every passage carries its own

The corpus lives in the repository as versioned Markdown, one file per document, with mandatory
front-matter. A validator (AG-2.4) fails the build on a missing field.

```yaml
id: kb-en-hypertension-001
language: en            # en | ar; a translation is its own document with translatedFrom
title: High blood pressure — overview
source:
  publisher: World Health Organization
  url: https://…
  retrievedOn: 2026-10-10
  licence: CC BY-NC-SA 3.0 IGO   # copied from the source page, never assumed
  licenceVerifiedBy: <name>
review:
  reviewer: <named clinical owner>   # KD-9
  reviewedOn: 2026-10-12
  nextReviewDue: 2027-04-12          # freshness, §2.6
  status: approved                   # draft | approved | retired
translatedFrom: null
audience: patient
topics: [cardiology, blood-pressure]
```

Only `status: approved` documents are indexed. A `retired` document stays in history with its review
record.

### 2.4 Indexing and retrieval (v1)

| Step | v1 design | Why |
|---|---|---|
| Chunking | By heading, 200–400 tokens, with the title and section breadcrumb repeated in each chunk | Citations point at a meaningful section |
| Normalization (Arabic) | Remove diacritics (tashkeel) and tatweel. Unify alef forms (أ إ آ → ا), ى → ي, ة → ه for matching only. Normalize Arabic-Indic digits. The original text is kept for display | Arabic queries otherwise miss on orthographic variants |
| Index | BM25 lexical index built at build time from approved files and shipped as a versioned artifact | **No database or schema change** (stays within the AI domain). Deterministic and testable |
| Query | The user message plus the model's rewritten query (one structured call). Language-matched first, then cross-language fallback flagged as such | Bilingual coverage while the corpus is uneven |
| Threshold | Below the score threshold, retrieval returns nothing, and the assistant says it cannot answer reliably | No ungrounded medical claims |
| Embeddings | **Later, measured upgrade** (hybrid retrieval). Needs an embedding provider approved under the same §4.3 terms gate and, if stored in PostgreSQL, a Database-owned `pgvector` change (IC-10) | Only adopted if recall@5 improves on the eval set |

### 2.5 How retrieved content is used

- Passages enter the prompt inside a delimited block with their `id`, title and source. The system
  prompt requires every medical statement to cite a passage id.
- The post-generation validator checks that cited ids were actually retrieved this turn and strips
  any citation that was not. An answer with medical content and no valid citation is replaced with
  the "cannot answer reliably" message (AG-7.3).
- Retrieved text is **untrusted for instructions** (`AI_SAFETY_AND_SECURITY.md` §4).

### 2.6 Freshness and updates

| Event | Procedure |
|---|---|
| Scheduled review | `nextReviewDue` at most 6 months out. A CI check lists documents past due. Past-due documents are de-indexed until re-reviewed |
| Source changed | Re-retrieve, diff, and re-review. The version bump is recorded in git history |
| Error reported (patient feedback or reviewer) | Retire the document immediately (one-line front-matter change), rebuild, redeploy. Then fix and re-review |
| Corpus release | The corpus version is recorded on every eval report and in `describe()` metadata, so an answer can be traced to the corpus that produced it |

### 2.7 Retrieval quality (measured, not assumed)

A labelled query set (bilingual; AG-2.6) records the expected document ids per query. Measured:

- recall@5;
- MRR;
- "should refuse" precision (queries with no supported answer must retrieve nothing above threshold).

Thresholds are in `AI_EVALUATION_AND_TESTING.md` §5.

---

## 3. Live data (K2): always from the application

- Every hospital, doctor, specialty, slot, rating and insurance fact the assistant states must come
  from a tool result in the **current** conversation turn or an earlier turn of the same
  conversation, and slot availability must be from the current turn.
- If a fact is not available from a tool, the assistant says so. It never estimates distances,
  ratings, prices, waiting times or insurance coverage.
- Ratings and reviews come only from the moderated discovery API (OD-10). They are never generated
  and never summarized beyond what the API returns.

## 4. Patient data (K3): minimum necessary

- The agent reads only what the patient's own app can read, through the same self-scoped services.
- Tool results stored in the conversation are **projections** (ids, names, times, status, hospital),
  not raw API payloads. Long results are referenced by id and re-fetched rather than stored.
- No long-term memory or profile is built from conversations. Each conversation starts from the
  frozen system prompt, the patient's language preference and server-provided `now`.
- Conversations are not used for training or for the knowledge base.
- Logs are metadata only, following `AiTranscriptLog`.
- Retention, deletion and staff visibility: OPEN, KD-6.

## 5. Evaluation data (K4)

- Scenarios use **synthetic** personas and fixture hospitals and doctors created for tests. They are
  labelled as synthetic in their front-matter and live only in test fixtures, never in the production
  database or corpus.
- Synthetic clinical vignettes used for red-flag tests are reviewed by the clinical owner. They are
  test inputs, not medical facts.
- Real conversations are not copied into eval sets. If production feedback motivates a new case, it
  is rewritten as a synthetic scenario.

## 6. Fine-tuning (K5): not planned

Fine-tuning is **not** part of this plan. It may be proposed later only with a written proposal that
states all of the following:

1. the measured failure it solves, which prompting, structured output, tools or retrieval could not
   fix on the current eval suite;
2. dataset provenance and licence for every example;
3. proof that no real patient data, credentials or hospital-confidential data is included, and how
   that is enforced;
4. the baseline scores on the frozen eval suite and the target improvement;
5. acceptance criteria, including no regression on safety (EV-S*) and isolation (PN-*) sets;
6. owner approval. DR-12 already forbids training on cross-hospital data, ever.
