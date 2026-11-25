-- Row-Level Security for files and messaging, corrected against the real
-- runtime role (final verification of the security remediation).
--
-- Running the whole e2e suite with the application connected as the
-- restricted role showed two tables whose policy did not match their data:
--
-- * `files` used the organisational rule (`hospital_id` = the request's
--   hospital). An upload has no hospital until it is linked to a chart, and a
--   profile photo or a patient's own upload never has one, so every upload
--   was refused, and a patient could not read their own documents.
-- * `conversations` used the clinical rule (`hospital_id` and `patient_id`).
--   A staff thread about nobody has neither, so every ordinary conversation
--   was refused; and the child tables inherited that.
--
-- The replacements keep every tenant boundary and add the per-user ones the
-- application already enforces, so the database refuses what the
-- application would:
--
-- files       read: system; platform (organisational, as before); the
--                   file's hospital; its uploader; the public kinds; the
--                   patient a document, record attachment or lab attachment
--                   belongs to; a participant of the conversation it is
--                   attached to.
--             write: system; the uploader, for a file not yet in another
--                   hospital; the file's hospital (linking adopts a file into
--                   it). Delete: system or the uploader.
-- conversations read: system; platform (metadata, for oversight); a
--                   participant; for a patient thread, the clinical rule.
--             insert: system; anyone signed in, for a thread about nobody;
--                   for a patient thread, the clinical write rule (the thread
--                   belongs to the hospital where the author reaches them).
--             update: system or a participant. Delete: system.
-- participants: system; the row's own user; a participant of the thread; or
--                   the first participants of a thread that has none yet (its
--                   creation).
-- messages    read: system; a participant; a Platform Admin holding a live
--                   content-access grant for that thread (ADR-006, F-12) —
--                   metadata access to a conversation is not access to its
--                   messages. Write: system or a participant.
--
-- The membership and linkage checks are SECURITY DEFINER helpers with a
-- pinned search_path: they answer yes or no about the caller and disclose no
-- row, and they keep the policies from recursing through each other.

CREATE OR REPLACE FUNCTION app_rls.is_conversation_participant(p_conversation uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $fn$
  SELECT app_rls.current_user_id() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.conversation_participants cp
     WHERE cp.conversation_id = p_conversation AND cp.user_id = app_rls.current_user_id())
$fn$;

CREATE OR REPLACE FUNCTION app_rls.conversation_has_no_participants(p_conversation uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $fn$
  SELECT NOT EXISTS (SELECT 1 FROM public.conversation_participants cp WHERE cp.conversation_id = p_conversation)
$fn$;

CREATE OR REPLACE FUNCTION app_rls.has_content_grant(p_conversation uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $fn$
  SELECT app_rls.current_user_id() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.communication_access_requests r
     WHERE r.conversation_id = p_conversation
       AND r.requested_by = app_rls.current_user_id()
       AND r.status = 'approved'
       AND r.expires_at > now())
$fn$;

CREATE OR REPLACE FUNCTION app_rls.file_of_current_patient(p_file uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $fn$
  SELECT app_rls.current_patient_id() IS NOT NULL AND (
       EXISTS (SELECT 1 FROM public.patient_documents d
                WHERE d.file_id = p_file AND d.patient_id = app_rls.current_patient_id())
    OR EXISTS (SELECT 1 FROM public.record_attachments a JOIN public.medical_records r ON r.id = a.record_id
                WHERE a.file_id = p_file AND r.patient_id = app_rls.current_patient_id())
    OR EXISTS (SELECT 1 FROM public.lab_attachments a JOIN public.lab_orders o ON o.id = a.lab_order_id
                WHERE a.file_id = p_file AND o.patient_id = app_rls.current_patient_id()))
$fn$;

CREATE OR REPLACE FUNCTION app_rls.file_in_my_conversation(p_file uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $fn$
  SELECT app_rls.current_user_id() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.message_attachments ma
      JOIN public.messages m ON m.id = ma.message_id
      JOIN public.conversation_participants cp ON cp.conversation_id = m.conversation_id
     WHERE ma.file_id = p_file AND cp.user_id = app_rls.current_user_id())
$fn$;

REVOKE ALL ON FUNCTION app_rls.is_conversation_participant(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_rls.conversation_has_no_participants(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_rls.has_content_grant(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_rls.file_of_current_patient(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_rls.file_in_my_conversation(uuid) FROM PUBLIC;

-- ── files ────────────────────────────────────────────────────────────────
DROP POLICY files_tenant ON public.files;

CREATE POLICY files_read ON public.files FOR SELECT USING (
     app_rls.scope() IN ('system', 'platform')
  OR (hospital_id IS NOT NULL AND app_rls.org_visible(hospital_id))
  OR uploaded_by = app_rls.current_user_id()
  OR kind IN ('profile_photo', 'branding_asset')
  OR app_rls.file_of_current_patient(id)
  OR app_rls.file_in_my_conversation(id));

CREATE POLICY files_insert ON public.files FOR INSERT WITH CHECK (
     app_rls.scope() = 'system'
  OR (uploaded_by = app_rls.current_user_id()
      AND (hospital_id IS NULL OR app_rls.org_visible(hospital_id))));

CREATE POLICY files_update ON public.files FOR UPDATE
  USING (
       app_rls.scope() = 'system'
    OR uploaded_by = app_rls.current_user_id()
    OR (hospital_id IS NOT NULL AND app_rls.org_visible(hospital_id)))
  WITH CHECK (
       app_rls.scope() = 'system'
    OR (hospital_id IS NOT NULL AND app_rls.org_visible(hospital_id))
    OR (hospital_id IS NULL AND uploaded_by = app_rls.current_user_id()));

CREATE POLICY files_delete ON public.files FOR DELETE USING (
  app_rls.scope() = 'system' OR uploaded_by = app_rls.current_user_id());

-- ── conversations ────────────────────────────────────────────────────────
DROP POLICY conversations_read ON public.conversations;
DROP POLICY conversations_insert ON public.conversations;
DROP POLICY conversations_update ON public.conversations;
DROP POLICY conversations_delete ON public.conversations;

CREATE POLICY conversations_read ON public.conversations FOR SELECT USING (
     app_rls.scope() IN ('system', 'platform')
  OR app_rls.is_conversation_participant(id)
  OR (patient_id IS NOT NULL AND app_rls.clinical_visible(hospital_id, patient_id)));

CREATE POLICY conversations_insert ON public.conversations FOR INSERT WITH CHECK (
     app_rls.scope() = 'system'
  OR (patient_id IS NULL AND hospital_id IS NULL AND app_rls.current_user_id() IS NOT NULL)
  OR (patient_id IS NOT NULL AND app_rls.clinical_writable(hospital_id, patient_id)));

CREATE POLICY conversations_update ON public.conversations FOR UPDATE
  USING (app_rls.scope() = 'system' OR app_rls.is_conversation_participant(id))
  WITH CHECK (app_rls.scope() = 'system' OR app_rls.is_conversation_participant(id));

CREATE POLICY conversations_delete ON public.conversations FOR DELETE USING (app_rls.scope() = 'system');

-- ── conversation_participants ────────────────────────────────────────────
DROP POLICY conversation_participants_via_conversations ON public.conversation_participants;

CREATE POLICY conversation_participants_access ON public.conversation_participants FOR ALL
  USING (
       app_rls.scope() IN ('system', 'platform')
    OR user_id = app_rls.current_user_id()
    OR app_rls.is_conversation_participant(conversation_id))
  WITH CHECK (
       app_rls.scope() = 'system'
    OR app_rls.is_conversation_participant(conversation_id)
    OR app_rls.conversation_has_no_participants(conversation_id));

-- ── messages ─────────────────────────────────────────────────────────────
DROP POLICY messages_via_conversations ON public.messages;

CREATE POLICY messages_read ON public.messages FOR SELECT USING (
     app_rls.scope() = 'system'
  OR app_rls.is_conversation_participant(conversation_id)
  OR (app_rls.scope() = 'platform' AND app_rls.has_content_grant(conversation_id)));

CREATE POLICY messages_write ON public.messages FOR INSERT WITH CHECK (
  app_rls.scope() = 'system' OR app_rls.is_conversation_participant(conversation_id));

CREATE POLICY messages_update ON public.messages FOR UPDATE
  USING (app_rls.scope() = 'system' OR app_rls.is_conversation_participant(conversation_id))
  WITH CHECK (app_rls.scope() = 'system' OR app_rls.is_conversation_participant(conversation_id));

CREATE POLICY messages_delete ON public.messages FOR DELETE USING (app_rls.scope() = 'system');
