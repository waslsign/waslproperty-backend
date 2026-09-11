-- CreateEnum
CREATE TYPE "PropertyType" AS ENUM ('RESIDENTIAL', 'COMMERCIAL', 'MIXED_USE');

-- CreateEnum
CREATE TYPE "PropertyStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SpaceType" AS ENUM ('APARTMENT', 'VILLA', 'OFFICE', 'RETAIL', 'WAREHOUSE', 'PARKING', 'STORAGE', 'COMMON_AREA', 'OTHER');

-- CreateEnum
CREATE TYPE "SpaceStatus" AS ENUM ('VACANT', 'OCCUPIED', 'UNDER_MAINTENANCE', 'RESERVED');

-- CreateEnum
CREATE TYPE "ContactType" AS ENUM ('OWNER', 'TENANT', 'RESIDENT');

-- CreateEnum
CREATE TYPE "ContactStatus" AS ENUM ('ACTIVE', 'INVITED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "PropertyRole" AS ENUM ('OWNER', 'TENANT', 'RESIDENT', 'PROPERTY_MANAGER', 'FACILITY_MANAGER', 'AGENT', 'OTHER');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'ENDED', 'PENDING');

-- CreateTable
CREATE TABLE "properties" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT,
    "country" TEXT NOT NULL,
    "postalCode" TEXT,
    "propertyType" "PropertyType" NOT NULL,
    "status" "PropertyStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spaces" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "spaceType" "SpaceType" NOT NULL,
    "floor" TEXT,
    "sizeSqft" INTEGER,
    "status" "SpaceStatus" NOT NULL DEFAULT 'VACANT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "spaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_contacts" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "userId" TEXT,
    "contactType" "ContactType" NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "status" "ContactStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "property_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_memberships" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "spaceId" TEXT,
    "contactId" TEXT NOT NULL,
    "role" "PropertyRole" NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "property_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "properties_organisationId_idx" ON "properties"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "properties_organisationId_code_key" ON "properties"("organisationId", "code");

-- CreateIndex
CREATE INDEX "spaces_organisationId_idx" ON "spaces"("organisationId");

-- CreateIndex
CREATE INDEX "spaces_propertyId_idx" ON "spaces"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "spaces_propertyId_code_key" ON "spaces"("propertyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "property_contacts_userId_key" ON "property_contacts"("userId");

-- CreateIndex
CREATE INDEX "property_contacts_organisationId_idx" ON "property_contacts"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "property_contacts_organisationId_email_key" ON "property_contacts"("organisationId", "email");

-- CreateIndex
CREATE INDEX "property_memberships_organisationId_idx" ON "property_memberships"("organisationId");

-- CreateIndex
CREATE INDEX "property_memberships_propertyId_idx" ON "property_memberships"("propertyId");

-- CreateIndex
CREATE INDEX "property_memberships_spaceId_idx" ON "property_memberships"("spaceId");

-- CreateIndex
CREATE INDEX "property_memberships_contactId_idx" ON "property_memberships"("contactId");

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_contacts" ADD CONSTRAINT "property_contacts_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_contacts" ADD CONSTRAINT "property_contacts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_memberships" ADD CONSTRAINT "property_memberships_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_memberships" ADD CONSTRAINT "property_memberships_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_memberships" ADD CONSTRAINT "property_memberships_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "property_contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
