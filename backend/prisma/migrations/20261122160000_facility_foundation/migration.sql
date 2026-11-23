-- Add the facility foundation without assigning or rewriting existing data.
-- Validate existing hospital timezones before the first schema change so an
-- invalid value aborts cleanly. Location timezone is newly nullable and starts NULL.
BEGIN;

DO $timezone_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.hospitals AS h
    WHERE h.timezone IS NULL
      OR NOT (
        h.timezone = 'UTC'
        OR (
          h.timezone ~ '^[A-Za-z0-9._+-]+(/[A-Za-z0-9._+-]+)+$'
          AND EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names AS z WHERE z.name = h.timezone)
        )
      )
  ) THEN
    RAISE EXCEPTION 'Facility migration stopped: hospitals contains a timezone that is not an accepted IANA zone. No rows were changed.'
      USING ERRCODE = '22023';
  END IF;
END
$timezone_preflight$;

CREATE TABLE public.clinics (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  public_id VARCHAR(40) NOT NULL,
  hospital_id UUID NOT NULL,
  name VARCHAR(120) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(3) NOT NULL,
  deleted_at TIMESTAMPTZ(3),
  CONSTRAINT clinics_pkey PRIMARY KEY (id),
  CONSTRAINT clinics_public_id_key UNIQUE (public_id),
  CONSTRAINT clinics_hospital_id_name_key UNIQUE (hospital_id, name),
  CONSTRAINT clinics_hospital_id_fkey FOREIGN KEY (hospital_id)
    REFERENCES public.hospitals(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT clinics_status_check CHECK (status IN ('ACTIVE', 'INACTIVE'))
);

CREATE INDEX clinics_hospital_id_status_idx ON public.clinics(hospital_id, status);
CREATE INDEX clinics_deleted_at_idx ON public.clinics(deleted_at);

ALTER TABLE public.hospital_locations
  ADD COLUMN timezone VARCHAR(64);

DO $location_timezone_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.hospital_locations AS l
    WHERE l.timezone IS NOT NULL
      AND NOT (
        l.timezone = 'UTC'
        OR (
          l.timezone ~ '^[A-Za-z0-9._+-]+(/[A-Za-z0-9._+-]+)+$'
          AND EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names AS z WHERE z.name = l.timezone)
        )
      )
  ) THEN
    RAISE EXCEPTION 'Facility migration stopped: hospital_locations contains an invalid timezone. No rows were changed.'
      USING ERRCODE = '22023';
  END IF;
END
$location_timezone_preflight$;

CREATE FUNCTION public.validate_facility_iana_timezone()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $timezone_validation$
BEGIN
  IF NEW.timezone IS NULL THEN
    IF TG_TABLE_NAME = 'hospitals' THEN
      RAISE EXCEPTION 'hospitals.timezone cannot be NULL'
        USING ERRCODE = '23502', COLUMN = 'timezone', TABLE = TG_TABLE_NAME;
    END IF;
    RETURN NEW;
  END IF;

  IF NOT (
    NEW.timezone = 'UTC'
    OR (
      NEW.timezone ~ '^[A-Za-z0-9._+-]+(/[A-Za-z0-9._+-]+)+$'
      AND EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names AS z WHERE z.name = NEW.timezone)
    )
  ) THEN
    RAISE EXCEPTION 'Invalid IANA timezone "%" for %.%', NEW.timezone, TG_TABLE_SCHEMA, TG_TABLE_NAME
      USING ERRCODE = '22023', COLUMN = 'timezone', TABLE = TG_TABLE_NAME;
  END IF;

  RETURN NEW;
END
$timezone_validation$;

CREATE TRIGGER hospitals_timezone_iana_trg
  BEFORE INSERT OR UPDATE OF timezone ON public.hospitals
  FOR EACH ROW EXECUTE FUNCTION public.validate_facility_iana_timezone();

CREATE TRIGGER hospital_locations_timezone_iana_trg
  BEFORE INSERT OR UPDATE OF timezone ON public.hospital_locations
  FOR EACH ROW EXECUTE FUNCTION public.validate_facility_iana_timezone();

COMMIT;