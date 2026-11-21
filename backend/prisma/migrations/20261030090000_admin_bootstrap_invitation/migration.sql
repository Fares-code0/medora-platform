-- The first-administrator bootstrap (ADR-035 "the first administrator of a
-- deployment must be seeded"; RM M38.4).
--
-- `invited_by` becomes nullable. NULL means exactly one thing: the
-- invitation was issued by an operator running `npm run admin:bootstrap`
-- on the server, when no administrator existed to send it. Every invitation
-- sent through `POST /auth/admin-invitations` still names its sender.
--
-- Additive: no row is rewritten, and the foreign key and its ON DELETE
-- CASCADE are unchanged.

-- AlterTable
ALTER TABLE "admin_invitations" ALTER COLUMN "invited_by" DROP NOT NULL;
