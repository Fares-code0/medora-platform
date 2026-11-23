-- A hard-deleted user takes its platform admin grants with it.
--
-- Accounts are soft-deleted in normal operation, and a grant is revoked,
-- never deleted. A hard delete of a user row is a data-erasure operation
-- (and the test harness's cleanup) that removes the account's history with
-- it; RESTRICT made that impossible once an account had ever held platform
-- scope. The foreign key now cascades, and the no-delete trigger permits a
-- delete only when it is that cascade: referential actions run after the
-- parent row is removed, so the cascade is recognised by the parent's
-- absence. A direct DELETE of a grant whose user still exists is refused.

ALTER TABLE "platform_admin_grants" DROP CONSTRAINT "platform_admin_grants_user_id_fkey";
ALTER TABLE "platform_admin_grants" ADD CONSTRAINT "platform_admin_grants_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION platform_admin_grants_no_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM users u WHERE u.id = OLD.user_id) THEN
    RAISE EXCEPTION 'platform_admin_grants rows are revoked, never deleted' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END $$;
