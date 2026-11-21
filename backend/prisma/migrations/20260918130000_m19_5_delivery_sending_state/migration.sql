-- M19.5 — `notification_deliveries` gains an in-flight state.
--
-- The channel worker claims pending rows with FOR UPDATE SKIP LOCKED and
-- moves them out of `pending` in the same statement, so two backend
-- instances cannot both send one email. That claim needs a state to move
-- them *to*: without one, a claimed row is indistinguishable from an
-- unclaimed one the moment the lock is released, and the worker would be
-- back to a read-modify-write race.
--
-- `sending` is deliberately not terminal. A row left in it by a crashed
-- worker is a delivery whose outcome is unknown — which is the truth,
-- and is what M30.1's retry policy and dead-letter queue will act on.
-- Marking such a row `sent` would be a lie an administrator could not
-- detect, and `failed` would send someone to look at a healthy relay.
--
-- The four other values are unchanged. `frontend`'s `DeliveryStatus`
-- union is already a subset of this vocabulary (it has no `skipped`),
-- and no endpoint projects this column today, so nothing on the wire
-- changes.

ALTER TABLE "notification_deliveries"
  DROP CONSTRAINT "notification_deliveries_status_check";

ALTER TABLE "notification_deliveries"
  ADD CONSTRAINT "notification_deliveries_status_check"
  CHECK ("status" IN ('pending', 'sending', 'sent', 'delivered', 'failed', 'skipped'));
