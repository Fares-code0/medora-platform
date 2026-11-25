-- Notifications under Row-Level Security, corrected against the real runtime
-- role (final verification of the security remediation).
--
-- `notifications` carried the clinical rule (`hospital_id` and `patient_id`),
-- but a notification is a message to one person: most name no patient, and
-- its recipient must always read it. Under the restricted role a recipient
-- could not see their own unpatiented notifications, and a request could not
-- notify anyone else.
--
-- read / update: system, or the recipient. Nobody else reads another person's
--                notifications (the content is a pointer, but the pointer is
--                theirs).
-- insert:        system; for a notification about nobody, any signed-in
--                request (dispatch notifies other people); for one about a
--                patient, the clinical write rule — only the hospital that
--                reaches the patient may point at them.
-- delete:        system.
--
-- `notification_deliveries` followed its parent through EXISTS, so a request
-- could not record the delivery rows of a notification it may not read. Its
-- rule is now: system or the parent's recipient; and a new delivery row for a
-- notification that exists (the dispatching request writes both in one
-- transaction). The helpers are SECURITY DEFINER and only answer yes or no.

CREATE OR REPLACE FUNCTION app_rls.notification_exists(p_notification uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.notifications n WHERE n.id = p_notification)
$fn$;

CREATE OR REPLACE FUNCTION app_rls.is_notification_recipient(p_notification uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $fn$
  SELECT app_rls.current_user_id() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.notifications n
     WHERE n.id = p_notification AND n.recipient_id = app_rls.current_user_id())
$fn$;

REVOKE ALL ON FUNCTION app_rls.notification_exists(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_rls.is_notification_recipient(uuid) FROM PUBLIC;

DROP POLICY notifications_read ON public.notifications;
DROP POLICY notifications_insert ON public.notifications;
DROP POLICY notifications_update ON public.notifications;
DROP POLICY notifications_delete ON public.notifications;

CREATE POLICY notifications_read ON public.notifications FOR SELECT USING (
  app_rls.scope() = 'system' OR recipient_id = app_rls.current_user_id());

CREATE POLICY notifications_insert ON public.notifications FOR INSERT WITH CHECK (
     app_rls.scope() = 'system'
  OR (patient_id IS NULL AND hospital_id IS NULL AND app_rls.current_user_id() IS NOT NULL)
  OR (patient_id IS NOT NULL AND app_rls.clinical_writable(hospital_id, patient_id)));

CREATE POLICY notifications_update ON public.notifications FOR UPDATE
  USING (app_rls.scope() = 'system' OR recipient_id = app_rls.current_user_id())
  WITH CHECK (app_rls.scope() = 'system' OR recipient_id = app_rls.current_user_id());

CREATE POLICY notifications_delete ON public.notifications FOR DELETE USING (app_rls.scope() = 'system');

DROP POLICY notification_deliveries_via_notifications ON public.notification_deliveries;

CREATE POLICY notification_deliveries_read ON public.notification_deliveries FOR SELECT USING (
  app_rls.scope() = 'system' OR app_rls.is_notification_recipient(notification_id));

CREATE POLICY notification_deliveries_insert ON public.notification_deliveries FOR INSERT WITH CHECK (
  app_rls.scope() = 'system' OR app_rls.notification_exists(notification_id));

CREATE POLICY notification_deliveries_update ON public.notification_deliveries FOR UPDATE
  USING (app_rls.scope() = 'system' OR app_rls.is_notification_recipient(notification_id))
  WITH CHECK (app_rls.scope() = 'system' OR app_rls.is_notification_recipient(notification_id));

CREATE POLICY notification_deliveries_delete ON public.notification_deliveries FOR DELETE USING (
  app_rls.scope() = 'system');
