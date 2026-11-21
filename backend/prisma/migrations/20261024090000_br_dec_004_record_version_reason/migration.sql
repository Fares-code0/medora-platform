-- BR-DEC-004 (DEC-004) — a medical-record edit carries a reason, persisted
-- with the version row it explains.
--
-- On the version row and nowhere else: the reason belongs to one edit, and
-- `record_versions` is already the insert-only history `GET …/versions`
-- serves. A column on `medical_records` would hold only the latest reason
-- and overwrite the one before it, which is the loss the decision exists
-- to prevent.
--
-- Nullable. Every version written before this migration has no reason, and
-- whether a reason is mandatory is a rule DEC-004 does not state ("accepted
-- and persisted"), so the application accepts one and the column does not
-- invent a requirement the owner has not made. 300 characters, the same
-- ceiling the other P4 reasons on this schema use.

ALTER TABLE "record_versions" ADD COLUMN "reason" VARCHAR(300);
