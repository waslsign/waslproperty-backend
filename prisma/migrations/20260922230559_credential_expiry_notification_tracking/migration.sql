-- AlterTable
ALTER TABLE "contractor_credentials" ADD COLUMN     "expiredNotifiedAt" TIMESTAMP(3),
ADD COLUMN     "expiringSoonNotifiedAt" TIMESTAMP(3);

