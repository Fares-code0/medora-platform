-- A legacy row gains an owner only with recorded evidence (security
-- remediation M2; S2 hardening).
--
-- `prevent_tenant_scope_reassignment` freezes a tenant key once it is set,
-- but deliberately let a NULL be filled in place — that is how a legacy row
-- (written before hospital attribution) is eventually assigned. Nothing tied
-- that fill to the evidence table, so any code running under `system` scope
-- could stamp legacy rows with a hospital and leave no record of why.
--
-- From here, filling a NULL `hospital_id` requires an `ownership_assignments`
-- row for the same table, row and hospital, written first (in the same
-- transaction, as the reviewed backfill will). The single exemption is
-- `files`: an upload is created unlinked and is adopted into a hospital
-- when a patient document or record attachment links it — the designed
-- runtime path, whose evidence is that link, validated by
-- `validate_clinical_file_owner` and `prevent_attached_file_reassignment`.
--
-- The function becomes SECURITY DEFINER (pinned search_path, reads only) so
-- that its evidence lookup is not hidden by the evidence table's own RLS
-- (system scope only). It still changes nothing and returns NEW.

CREATE OR REPLACE FUNCTION public.prevent_tenant_scope_reassignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE old_row jsonb := to_jsonb(OLD); new_row jsonb := to_jsonb(NEW); field_name text; old_value text; new_value text;
BEGIN
  FOREACH field_name IN ARRAY TG_ARGV LOOP
    old_value := old_row ->> field_name;
    new_value := new_row ->> field_name;
    IF old_value IS NOT NULL AND old_value IS DISTINCT FROM new_value THEN
      RAISE EXCEPTION 'Assigned tenant key % on %.% cannot be changed in place', field_name, TG_TABLE_SCHEMA, TG_TABLE_NAME
        USING ERRCODE = '23514';
    END IF;
    IF field_name = 'hospital_id' AND old_value IS NULL AND new_value IS NOT NULL
       AND TG_TABLE_NAME <> 'files'
       AND NOT EXISTS (
         SELECT 1 FROM public.ownership_assignments oa
          WHERE oa.table_name = TG_TABLE_NAME
            AND oa.row_id = (new_row ->> 'id')::uuid
            AND oa.hospital_id = new_value::uuid
       ) THEN
      RAISE EXCEPTION 'Legacy row %.% (%) gains hospital % only with an ownership_assignments evidence row',
        TG_TABLE_SCHEMA, TG_TABLE_NAME, new_row ->> 'id', new_value
        USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NEW;
END
$function$;

-- One evidence row per assigned row is already enforced by
-- `ownership_assignments_table_row_key` (migration 20261124100000).

-- A table name, not free text.
ALTER TABLE public.ownership_assignments
  ADD CONSTRAINT ownership_assignments_table_name_check
  CHECK (table_name ~ '^[a-z_][a-z0-9_]{0,62}$');
