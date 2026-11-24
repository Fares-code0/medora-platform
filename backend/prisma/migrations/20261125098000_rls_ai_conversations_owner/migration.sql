-- AI conversations under Row-Level Security (follows 20261125095000).
--
-- `ai_conversations` carried the clinical rule (`hospital_id` and
-- `patient_id`), so an assistant thread about nobody — the general mode —
-- could not be created or read under the runtime role. An assistant thread
-- is private to its owner: nobody else reads it, whatever their scope.
--
-- read / update / delete: system, or the owner.
-- insert:                 the owner — and for a thread bound to a patient,
--                         also the clinical write rule (the thread belongs to
--                         the hospital where the owner reaches the patient).
-- The application re-resolves the bound context on every answer
-- (`AiContextService.reresolve`), so a thread whose patient the owner can no
-- longer reach stops answering; the policy keeps the thread itself private.
-- `ai_messages` follow their conversation, as before.

DROP POLICY ai_conversations_read ON public.ai_conversations;
DROP POLICY ai_conversations_insert ON public.ai_conversations;
DROP POLICY ai_conversations_update ON public.ai_conversations;
DROP POLICY ai_conversations_delete ON public.ai_conversations;

CREATE POLICY ai_conversations_read ON public.ai_conversations FOR SELECT USING (
  app_rls.scope() = 'system' OR owner_id = app_rls.current_user_id());

CREATE POLICY ai_conversations_insert ON public.ai_conversations FOR INSERT WITH CHECK (
     app_rls.scope() = 'system'
  OR (owner_id = app_rls.current_user_id()
      AND (patient_id IS NULL OR app_rls.clinical_writable(hospital_id, patient_id))));

CREATE POLICY ai_conversations_update ON public.ai_conversations FOR UPDATE
  USING (app_rls.scope() = 'system' OR owner_id = app_rls.current_user_id())
  WITH CHECK (app_rls.scope() = 'system' OR owner_id = app_rls.current_user_id());

CREATE POLICY ai_conversations_delete ON public.ai_conversations FOR DELETE USING (
  app_rls.scope() = 'system' OR owner_id = app_rls.current_user_id());
