-- An active Exceptional Access grant always names its approver (audit F-11).
--
-- `exceptional_access_grants_approval_check` allowed an ACTIVE grant with no
-- approver whenever `requires_approval` was false, which the per-hospital
-- waiver set. The approved model (SECURITY_AND_DATA_ISOLATION.md §1, DR-06)
-- has a grant "approved by the target Hospital Admin", always: a missing
-- approver is not an approval. Only the Emergency Override (Break-Glass) is
-- active without one, and it is reviewed afterwards instead.
--
-- NOT VALID: enforced for every row written from now on; rows written under
-- the old rule are left for the operator to review (none exist in
-- production — the feature ships with this branch).

ALTER TABLE public.exceptional_access_grants
  ADD CONSTRAINT exceptional_access_grants_exceptional_approved_check
  CHECK (kind <> 'EXCEPTIONAL' OR status <> 'ACTIVE' OR approver_user_id IS NOT NULL) NOT VALID;
