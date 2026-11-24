-- Additive multi-hospital foundation. No existing data is changed.
-- No legacy migrations are edited or replayed by this implementation step.

CREATE TABLE "hospitals" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "public_id" VARCHAR(40) NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "legal_name" VARCHAR(200),
  "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  "timezone" VARCHAR(64) NOT NULL DEFAULT 'UTC',
  "phone" VARCHAR(30),
  "email" CITEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "deleted_at" TIMESTAMPTZ(3),
  CONSTRAINT "hospitals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "hospitals_public_id_key" UNIQUE ("public_id"),
  CONSTRAINT "hospitals_email_key" UNIQUE ("email"),
  CONSTRAINT "hospitals_status_check" CHECK ("status" IN ('ACTIVE', 'SUSPENDED', 'INACTIVE'))
);

CREATE INDEX "hospitals_status_idx" ON "hospitals"("status");
CREATE INDEX "hospitals_deleted_at_idx" ON "hospitals"("deleted_at");

CREATE TABLE "hospital_locations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "hospital_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "address_line_1" VARCHAR(200) NOT NULL,
  "address_line_2" VARCHAR(200),
  "city" VARCHAR(120) NOT NULL,
  "region" VARCHAR(120),
  "postal_code" VARCHAR(24),
  "country_code" VARCHAR(2) NOT NULL,
  "latitude" DECIMAL(9,6),
  "longitude" DECIMAL(9,6),
  "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "deleted_at" TIMESTAMPTZ(3),
  CONSTRAINT "hospital_locations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "hospital_locations_hospital_id_fkey" FOREIGN KEY ("hospital_id") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "hospital_locations_hospital_id_name_key" UNIQUE ("hospital_id", "name"),
  CONSTRAINT "hospital_locations_status_check" CHECK ("status" IN ('ACTIVE', 'INACTIVE')),
  CONSTRAINT "hospital_locations_coordinates_check" CHECK (("latitude" IS NULL) = ("longitude" IS NULL) AND ("latitude" IS NULL OR ("latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180)))
);

CREATE INDEX "hospital_locations_hospital_id_status_idx" ON "hospital_locations"("hospital_id", "status");
CREATE INDEX "hospital_locations_deleted_at_idx" ON "hospital_locations"("deleted_at");

