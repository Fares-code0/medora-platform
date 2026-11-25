-- The safety-flags queue under Row-Level Security (follows 20261125095000).
--
-- `message_flags` reached its rows through `messages`, which since
-- 20261125095000 a Platform Admin reads only under a live content-access
-- grant. That correctly hid message bodies, but also hid the flags queue
-- (API §9.11), which is oversight metadata: a flag carries its category,
-- source, status, resolution — and an `excerpt` the *reporter* chose to
-- attach when raising it. The queue never reads the message body, and
-- `communications.resolveFlags` governs it in the application.
--
-- So flags are readable and resolvable by platform scope, as well as by a
-- participant of the conversation the flagged message belongs to (as before)
-- and by system. Message bodies stay behind the grant.
--
-- NOTE for review: the reporter-supplied `excerpt` is the one piece of
-- message-derived text a Platform Admin sees without a grant. It is the
-- product's existing behaviour (ADR-006's flags queue), kept deliberately.

CREATE OR REPLACE FUNCTION app_rls.message_conversation_participant(p_message uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.messages m
     WHERE m.id = p_message AND app_rls.is_conversation_participant(m.conversation_id))
$fn$;

REVOKE ALL ON FUNCTION app_rls.message_conversation_participant(uuid) FROM PUBLIC;

DROP POLICY message_flags_via_message ON public.message_flags;

CREATE POLICY message_flags_access ON public.message_flags FOR ALL
  USING (
       app_rls.scope() IN ('system', 'platform')
    OR app_rls.message_conversation_participant(message_id))
  WITH CHECK (
       app_rls.scope() IN ('system', 'platform')
    OR app_rls.message_conversation_participant(message_id));
