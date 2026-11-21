-- CreateTable
CREATE TABLE "doctors" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "photo_url" TEXT,
    "full_name" VARCHAR(80) NOT NULL,
    "title" VARCHAR(60),
    "specialty" VARCHAR(60) NOT NULL,
    "license_number" VARCHAR(40) NOT NULL,
    "license_expires_on" DATE,
    "employee_id" VARCHAR(40),
    "department_id" UUID,
    "hospital" VARCHAR(80),
    "years_of_experience" SMALLINT NOT NULL DEFAULT 0,
    "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "biography" TEXT,
    "education" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "certifications" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "linkedin_url" TEXT,
    "website_url" TEXT,
    "emergency_contact_name" VARCHAR(80),
    "emergency_contact_phone" VARCHAR(30),
    "contact_email" CITEXT NOT NULL,
    "contact_phone" VARCHAR(30) NOT NULL,
    "office_location" VARCHAR(80),
    "office_hours" VARCHAR(80),
    "verification_status" "doctor_verification_status" NOT NULL DEFAULT 'pending',
    "verified_at" TIMESTAMPTZ(3),
    "verified_by" UUID,
    "practice_status" "doctor_practice_status" NOT NULL DEFAULT 'active',
    "rating_avg" DECIMAL(3,2),
    "default_duration_min" SMALLINT NOT NULL DEFAULT 30,
    "buffer_min" SMALLINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "doctors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_specialties" (
    "doctor_id" UUID NOT NULL,
    "specialty_id" UUID NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doctor_specialties_pkey" PRIMARY KEY ("doctor_id","specialty_id")
);

-- CreateTable
CREATE TABLE "admin_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "photo_url" TEXT,
    "full_name" VARCHAR(80) NOT NULL,
    "title" VARCHAR(80),
    "biography" TEXT,
    "contact_email" CITEXT NOT NULL,
    "contact_phone" VARCHAR(30),
    "office_location" VARCHAR(80),
    "emergency_contact_name" VARCHAR(80),
    "emergency_contact_phone" VARCHAR(30),
    "education" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "certifications" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "experience" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "linkedin_url" TEXT,
    "website_url" TEXT,
    "landing_section" VARCHAR(30) NOT NULL DEFAULT 'overview',
    "weekly_digest" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "admin_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID,
    "name" VARCHAR(120) NOT NULL,
    "role" "staff_role" NOT NULL,
    "title" VARCHAR(80) NOT NULL,
    "department_id" UUID NOT NULL,
    "status" "presence_status" NOT NULL DEFAULT 'off-duty',
    "phone" VARCHAR(30) NOT NULL,
    "email" CITEXT NOT NULL,
    "working_hours" VARCHAR(80) NOT NULL,
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "avatar_url" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "staff_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_shift_assignments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "staff_id" UUID NOT NULL,
    "kind" "shift_kind" NOT NULL,
    "days" BOOLEAN[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "staff_shift_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rooms" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(80) NOT NULL,
    "kind" "room_kind" NOT NULL,
    "status" "room_status" NOT NULL DEFAULT 'available',
    "capacity" SMALLINT NOT NULL,
    "note" VARCHAR(300),
    "department_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resources" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(120) NOT NULL,
    "category" VARCHAR(80) NOT NULL,
    "location" VARCHAR(120) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reorder_level" INTEGER NOT NULL,
    "status" "resource_status" NOT NULL DEFAULT 'in-stock',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinic_working_days" (
    "day" "weekday" NOT NULL,
    "open" BOOLEAN NOT NULL,
    "start_time" TIME(0) NOT NULL,
    "end_time" TIME(0) NOT NULL,
    "break_label" VARCHAR(80),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "clinic_working_days_pkey" PRIMARY KEY ("day")
);

-- CreateTable
CREATE TABLE "holidays" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(120) NOT NULL,
    "date" DATE NOT NULL,
    "kind" "holiday_kind" NOT NULL,
    "recurring" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "doctors_user_id_key" ON "doctors"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "doctors_license_number_key" ON "doctors"("license_number");

-- CreateIndex
CREATE UNIQUE INDEX "doctors_employee_id_key" ON "doctors"("employee_id");

-- CreateIndex
CREATE INDEX "doctors_deleted_at_idx" ON "doctors"("deleted_at");

-- CreateIndex
CREATE INDEX "doctors_department_id_idx" ON "doctors"("department_id");

-- CreateIndex
CREATE INDEX "doctors_verification_status_idx" ON "doctors"("verification_status");

-- CreateIndex
CREATE INDEX "doctors_practice_status_idx" ON "doctors"("practice_status");

-- CreateIndex
CREATE INDEX "doctor_specialties_specialty_id_idx" ON "doctor_specialties"("specialty_id");

-- CreateIndex
CREATE UNIQUE INDEX "admin_profiles_user_id_key" ON "admin_profiles"("user_id");

-- CreateIndex
CREATE INDEX "admin_profiles_deleted_at_idx" ON "admin_profiles"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "staff_members_email_key" ON "staff_members"("email");

-- CreateIndex
CREATE INDEX "staff_members_deleted_at_idx" ON "staff_members"("deleted_at");

-- CreateIndex
CREATE INDEX "staff_members_department_id_idx" ON "staff_members"("department_id");

-- CreateIndex
CREATE INDEX "staff_shift_assignments_deleted_at_idx" ON "staff_shift_assignments"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "staff_shift_assignments_staff_id_kind_key" ON "staff_shift_assignments"("staff_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "rooms_name_key" ON "rooms"("name");

-- CreateIndex
CREATE INDEX "rooms_deleted_at_idx" ON "rooms"("deleted_at");

-- CreateIndex
CREATE INDEX "rooms_department_id_idx" ON "rooms"("department_id");

-- CreateIndex
CREATE INDEX "resources_deleted_at_idx" ON "resources"("deleted_at");

-- CreateIndex
CREATE INDEX "holidays_date_idx" ON "holidays"("date");

-- CreateIndex
CREATE INDEX "holidays_deleted_at_idx" ON "holidays"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "holidays_name_date_key" ON "holidays"("name", "date");

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_head_staff_id_fkey" FOREIGN KEY ("head_staff_id") REFERENCES "staff_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctors" ADD CONSTRAINT "doctors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctors" ADD CONSTRAINT "doctors_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctors" ADD CONSTRAINT "doctors_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_specialties" ADD CONSTRAINT "doctor_specialties_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_specialties" ADD CONSTRAINT "doctor_specialties_specialty_id_fkey" FOREIGN KEY ("specialty_id") REFERENCES "specialties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_profiles" ADD CONSTRAINT "admin_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_members" ADD CONSTRAINT "staff_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_members" ADD CONSTRAINT "staff_members_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_shift_assignments" ADD CONSTRAINT "staff_shift_assignments_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────
-- Hand-written from here down (RM M5.3). See the M5.2 migration for what
-- the drift check does and does not see; CHECKs and partial indexes are
-- in the "not seen" half and are held by failing-insert tests instead.

-- DB §B1 — the validation the `profileSchema` already applies client-side.
-- Restating it here is the point: the schema is one client's opinion, and
-- the column is where the rule has to survive a second one.
ALTER TABLE "doctors"
  ADD CONSTRAINT "doctors_years_of_experience_range"
  CHECK ("years_of_experience" BETWEEN 0 AND 70);

ALTER TABLE "doctors"
  ADD CONSTRAINT "doctors_rating_avg_range"
  CHECK ("rating_avg" IS NULL OR "rating_avg" BETWEEN 0 AND 5);

ALTER TABLE "doctors"
  ADD CONSTRAINT "doctors_biography_length" CHECK (char_length("biography") <= 600);

-- The bounded list caps of DB §B1. Stored as `text[]` per §14.3, so the
-- bound is a constraint rather than a table shape. An unbounded array on
-- a row every appointment list joins to is a payload-size problem.
ALTER TABLE "doctors"
  ADD CONSTRAINT "doctors_languages_max" CHECK (coalesce(array_length("languages", 1), 0) <= 8);
ALTER TABLE "doctors"
  ADD CONSTRAINT "doctors_education_max" CHECK (coalesce(array_length("education", 1), 0) <= 8);
ALTER TABLE "doctors"
  ADD CONSTRAINT "doctors_certifications_max"
  CHECK (coalesce(array_length("certifications", 1), 0) <= 8);
ALTER TABLE "doctors"
  ADD CONSTRAINT "doctors_skills_max" CHECK (coalesce(array_length("skills", 1), 0) <= 12);

-- ADR-005 §2 — "`default_duration_min` ∈ {15,20,30,45,60} (validated —
-- the API contract fixes this set)". A slot length outside it produces
-- a grid the booking UI cannot render.
ALTER TABLE "doctors"
  ADD CONSTRAINT "doctors_default_duration_allowed"
  CHECK ("default_duration_min" IN (15, 20, 30, 45, 60));

-- A negative buffer would *overlap* adjacent appointments rather than
-- separate them — the conflict check of ADR-005 §4 rule 4 extends each
-- slot by this value on both sides.
ALTER TABLE "doctors"
  ADD CONSTRAINT "doctors_buffer_non_negative" CHECK ("buffer_min" >= 0);

-- One primary specialty per doctor. A partial unique index, because the
-- constraint applies only to the flagged rows — a doctor may hold any
-- number of secondary specialties.
CREATE UNIQUE INDEX "doctor_specialties_one_primary"
  ON "doctor_specialties" ("doctor_id") WHERE "is_primary";

-- DB §K3 — seven days, index 0 = Monday. Postgres accepts `boolean[7]`
-- as a column type and then ignores the 7, so the length is only real
-- here. A six-element mask would silently drop Sunday from every rota.
ALTER TABLE "staff_shift_assignments"
  ADD CONSTRAINT "staff_shift_assignments_days_is_week"
  CHECK (array_length("days", 1) = 7);

-- DB §9 — `capacity > 0`. A room that holds nobody is not a room.
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_capacity_positive" CHECK ("capacity" > 0);

-- DB §K5 — stock counts are non-negative. A negative quantity would
-- compare below `reorder_level` and sit in the reorder alert forever.
ALTER TABLE "resources"
  ADD CONSTRAINT "resources_quantity_non_negative" CHECK ("quantity" >= 0);
ALTER TABLE "resources"
  ADD CONSTRAINT "resources_reorder_level_non_negative" CHECK ("reorder_level" >= 0);

-- DB §9, §K6 — `end_time > start_time`. A day that closes before it
-- opens makes every availability comparison in ADR-005 §4 vacuously false.
ALTER TABLE "clinic_working_days"
  ADD CONSTRAINT "clinic_working_days_end_after_start" CHECK ("end_time" > "start_time");
