-- Push-device registration (RM M41.2; patient mobile contract P5.8,
-- `POST /me/devices (push token)`).
--
-- An optional push token on the device a user already registers at
-- `POST /me/devices`. Nullable: a trusted device need not accept push, and
-- every existing row has none. Indexed because registering a token clears
-- it from any other device first (one device holds a given token).
--
-- Additive only.

-- AlterTable
ALTER TABLE "trusted_devices" ADD COLUMN     "push_token" VARCHAR(1024);

-- CreateIndex
CREATE INDEX "trusted_devices_push_token_idx" ON "trusted_devices"("push_token");
