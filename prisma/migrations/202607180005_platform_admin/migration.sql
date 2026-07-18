CREATE TYPE "PlatformRole" AS ENUM ('USER', 'SUPER_ADMIN');

ALTER TABLE "User"
ADD COLUMN "platformRole" "PlatformRole" NOT NULL DEFAULT 'USER';

CREATE INDEX "User_platformRole_status_idx"
ON "User"("platformRole", "status");
