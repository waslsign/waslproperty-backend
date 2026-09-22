-- Loosen PropertyContact.userId from a global unique constraint to one
-- scoped per organisation: a single User may be the property-scoped
-- portal identity for at most one contact within a given organisation,
-- but may hold that kind of identity in more than one organisation
-- simultaneously (e.g. staff at Org A who is also a resident at Org B,
-- or a resident at two entirely separate organisations).
DROP INDEX "property_contacts_userId_key";

CREATE UNIQUE INDEX "property_contacts_organisationId_userId_key" ON "property_contacts"("organisationId", "userId");
