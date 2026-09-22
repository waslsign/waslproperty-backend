-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "propertyContactId" TEXT;

-- CreateIndex
CREATE INDEX "sessions_propertyContactId_idx" ON "sessions"("propertyContactId");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_propertyContactId_fkey" FOREIGN KEY ("propertyContactId") REFERENCES "property_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
