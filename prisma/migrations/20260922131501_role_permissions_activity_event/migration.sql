-- Adds the activity event type used to audit organisation role-permission
-- changes (see src/modules/authorization). Purely additive enum value.

ALTER TYPE "ActivityEventType" ADD VALUE 'ROLE_PERMISSIONS_UPDATED';
