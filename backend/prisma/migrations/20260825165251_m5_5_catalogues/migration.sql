-- CreateTable
CREATE TABLE "lab_test_catalogue" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(120) NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "category" "lab_test_category" NOT NULL,
    "specimen_type" "lab_specimen_type" NOT NULL,
    "container" VARCHAR(60) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "lab_test_catalogue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_analyte_specs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "test_id" UUID NOT NULL,
    "analyte" VARCHAR(80) NOT NULL,
    "unit" VARCHAR(20) NOT NULL,
    "ref_low" DECIMAL(10,3),
    "ref_high" DECIMAL(10,3),
    "decimals" SMALLINT DEFAULT 0,
    "critical_low" DECIMAL(10,3),
    "critical_high" DECIMAL(10,3),
    "qualitative_options" TEXT[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "lab_analyte_specs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(120) NOT NULL,
    "generic_name" VARCHAR(120) NOT NULL,
    "category" "medication_category" NOT NULL,
    "form" "medication_form" NOT NULL,
    "route" "medication_route" NOT NULL,
    "manufacturer" VARCHAR(80) NOT NULL,
    "is_controlled" BOOLEAN NOT NULL DEFAULT false,
    "is_high_risk" BOOLEAN NOT NULL DEFAULT false,
    "interaction_note" TEXT,
    "allergy_class" VARCHAR(60),
    "frequencies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "durations_days" SMALLINT[] DEFAULT ARRAY[]::SMALLINT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "medications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medication_strengths" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "medication_id" UUID NOT NULL,
    "strength" VARCHAR(30) NOT NULL,
    "position" SMALLINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "medication_strengths_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drug_interactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "medication_a_id" UUID NOT NULL,
    "medication_b_id" UUID NOT NULL,
    "severity" "safety_warning_severity" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "detail" TEXT NOT NULL,
    "management" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "drug_interactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medication_monographs" (
    "medication_id" UUID NOT NULL,
    "indications" TEXT,
    "contraindications" TEXT,
    "standard_dosing" TEXT,
    "pregnancy_category" VARCHAR(1),
    "warnings" TEXT,
    "side_effects" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "medication_monographs_pkey" PRIMARY KEY ("medication_id")
);

-- CreateTable
CREATE TABLE "ai_prompt_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" VARCHAR(60) NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "description" VARCHAR(300),
    "prompt_text" TEXT NOT NULL,
    "context_mode" "ai_context_mode",
    "position" SMALLINT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "ai_prompt_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lab_test_catalogue_code_key" ON "lab_test_catalogue"("code");

-- CreateIndex
CREATE INDEX "lab_test_catalogue_name_trgm_idx" ON "lab_test_catalogue" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "lab_analyte_specs_test_id_analyte_key" ON "lab_analyte_specs"("test_id", "analyte");

-- CreateIndex
CREATE INDEX "medications_name_trgm_idx" ON "medications" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "medications_generic_name_trgm_idx" ON "medications" USING GIN ("generic_name" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "medications_name_generic_name_key" ON "medications"("name", "generic_name");

-- CreateIndex
CREATE UNIQUE INDEX "medication_strengths_medication_id_strength_key" ON "medication_strengths"("medication_id", "strength");

-- CreateIndex
CREATE INDEX "drug_interactions_medication_b_id_idx" ON "drug_interactions"("medication_b_id");

-- CreateIndex
CREATE UNIQUE INDEX "drug_interactions_medication_a_id_medication_b_id_key" ON "drug_interactions"("medication_a_id", "medication_b_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_prompt_templates_slug_key" ON "ai_prompt_templates"("slug");

-- AddForeignKey
ALTER TABLE "lab_analyte_specs" ADD CONSTRAINT "lab_analyte_specs_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "lab_test_catalogue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_strengths" ADD CONSTRAINT "medication_strengths_medication_id_fkey" FOREIGN KEY ("medication_id") REFERENCES "medications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drug_interactions" ADD CONSTRAINT "drug_interactions_medication_a_id_fkey" FOREIGN KEY ("medication_a_id") REFERENCES "medications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drug_interactions" ADD CONSTRAINT "drug_interactions_medication_b_id_fkey" FOREIGN KEY ("medication_b_id") REFERENCES "medications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_monographs" ADD CONSTRAINT "medication_monographs_medication_id_fkey" FOREIGN KEY ("medication_id") REFERENCES "medications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────
-- Hand-written from here down (RM M5.5).

-- DB §9 — "lab specs: `critical_low < ref_low`, `critical_high > ref_high`
-- (where non-null)". These are clinical rather than tidy: a critical_low
-- sitting *above* the reference low would mark ordinary results critical
-- and bury the genuine ones in the "Critical unreviewed: N" chip.
ALTER TABLE "lab_analyte_specs"
  ADD CONSTRAINT "lab_analyte_specs_critical_low_below_ref"
  CHECK ("critical_low" IS NULL OR "ref_low" IS NULL OR "critical_low" < "ref_low");
ALTER TABLE "lab_analyte_specs"
  ADD CONSTRAINT "lab_analyte_specs_critical_high_above_ref"
  CHECK ("critical_high" IS NULL OR "ref_high" IS NULL OR "critical_high" > "ref_high");

-- A reference range that is inverted is not a range.
ALTER TABLE "lab_analyte_specs"
  ADD CONSTRAINT "lab_analyte_specs_ref_range_ordered"
  CHECK ("ref_low" IS NULL OR "ref_high" IS NULL OR "ref_low" <= "ref_high");

-- DB §E2 — display precision 0–3.
ALTER TABLE "lab_analyte_specs"
  ADD CONSTRAINT "lab_analyte_specs_decimals_range"
  CHECK ("decimals" IS NULL OR "decimals" BETWEEN 0 AND 3);

-- An analyte is either numeric (a reference range) or qualitative (a list
-- of options), never neither. Without this an analyte can exist that no
-- result can be flagged against — it would render every value as
-- "normal" because nothing contradicts it.
ALTER TABLE "lab_analyte_specs"
  ADD CONSTRAINT "lab_analyte_specs_range_or_options"
  CHECK (
    ("ref_low" IS NOT NULL OR "ref_high" IS NOT NULL)
    OR coalesce(array_length("qualitative_options", 1), 0) > 0
  );

-- ADR-010 group 8 — the pair is stored once, in a fixed order.
--
-- Both directions would be two rows that can disagree about severity,
-- and an interaction screen whose answer depends on which drug the
-- caller named first is worse than no screen at all. The ordering makes
-- the unique index on (a, b) actually mean "this pair", and callers
-- normalize before lookup.
ALTER TABLE "drug_interactions"
  ADD CONSTRAINT "drug_interactions_pair_ordered"
  CHECK ("medication_a_id" < "medication_b_id");

-- DB §F1 — the durations offered on the prescribing form.
ALTER TABLE "medications"
  ADD CONSTRAINT "medications_durations_positive"
  CHECK ("durations_days" IS NULL OR 0 < ALL ("durations_days"));

-- Free text here would eventually hold "probably fine".
ALTER TABLE "medication_monographs"
  ADD CONSTRAINT "medication_monographs_pregnancy_category_check"
  CHECK ("pregnancy_category" IS NULL OR "pregnancy_category" IN ('A', 'B', 'C', 'D', 'X'));
