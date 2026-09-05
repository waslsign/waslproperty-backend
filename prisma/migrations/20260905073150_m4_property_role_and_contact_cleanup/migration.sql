-- AlterEnum
BEGIN;
CREATE TYPE "MembershipStatus_new" AS ENUM ('ACTIVE', 'ENDED');
ALTER TABLE "public"."property_memberships" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "property_memberships" ALTER COLUMN "status" TYPE "MembershipStatus_new" USING ("status"::text::"MembershipStatus_new");
ALTER TYPE "MembershipStatus" RENAME TO "MembershipStatus_old";
ALTER TYPE "MembershipStatus_new" RENAME TO "MembershipStatus";
DROP TYPE "public"."MembershipStatus_old";
ALTER TABLE "property_memberships" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "PropertyRole_new" AS ENUM ('OWNER', 'TENANT', 'RESIDENT', 'PROPERTY_MANAGER', 'FACILITY_MANAGER', 'AGENT', 'COMMITTEE_MEMBER');
ALTER TABLE "property_memberships" ALTER COLUMN "role" TYPE "PropertyRole_new" USING ("role"::text::"PropertyRole_new");
ALTER TYPE "PropertyRole" RENAME TO "PropertyRole_old";
ALTER TYPE "PropertyRole_new" RENAME TO "PropertyRole";
DROP TYPE "public"."PropertyRole_old";
COMMIT;

-- AlterTable
ALTER TABLE "property_contacts" DROP COLUMN "contactType";

-- DropEnum
DROP TYPE "ContactType";

