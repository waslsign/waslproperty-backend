/**
 * Grants (or creates and grants) Backoffice access to a WaslProperty
 * employee — the only way to create the first PLATFORM_SUPER_ADMIN, since
 * every UI path into the Internal Users screen itself requires
 * platformUsers.manage, which only a PLATFORM_SUPER_ADMIN already holds.
 *
 * Deliberately does NOT reuse AuthService.register — that creates a
 * customer Organisation + OrganisationMembership, exactly the "platform
 * employees are not customer organisation members" mixing this milestone
 * was told to avoid. This creates a bare User (if one doesn't already
 * exist for the given email) with no organisation relationship at all.
 *
 * Usage:
 *   npx tsx prisma/create-platform-user.ts \
 *     --email hamza@waslproperty.internal \
 *     --username admin.hamza \
 *     --password "temporary-strong-password" \
 *     --firstName Hamza --lastName Tariq \
 *     --role PLATFORM_SUPER_ADMIN
 *
 * --email identifies/creates the underlying User account; --username is
 * the separate identifier they actually sign in to the Backoffice with.
 */
import { PrismaClient, type PlatformRole } from '@prisma/client';
import { hashPassword } from '../src/lib/password.js';

const prisma = new PrismaClient();

function readArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const eqForm = process.argv.find((a) => a.startsWith(prefix));
  if (eqForm) return eqForm.slice(prefix.length);
  const idx = process.argv.indexOf(`--${name}`);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return undefined;
}

const VALID_ROLES: PlatformRole[] = [
  'PLATFORM_SUPER_ADMIN',
  'PLATFORM_ADMIN',
  'PLATFORM_SUPPORT',
  'PLATFORM_DEVELOPER',
];

async function main() {
  const email = readArg('email')?.trim().toLowerCase();
  const username = readArg('username')?.trim().toLowerCase();
  const password = readArg('password');
  const firstName = readArg('firstName') ?? 'Platform';
  const lastName = readArg('lastName') ?? 'User';
  const role = readArg('role') as PlatformRole | undefined;

  if (!email || !username || !role) {
    console.error('Usage: --email <email> --username <username> --password <password> --role <PlatformRole>');
    console.error(`Valid roles: ${VALID_ROLES.join(', ')}`);
    process.exit(1);
  }
  if (!VALID_ROLES.includes(role)) {
    console.error(`Invalid role "${role}". Valid roles: ${VALID_ROLES.join(', ')}`);
    process.exit(1);
  }

  let user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    if (!password) {
      console.error(`No user exists for ${email} yet — pass --password to create one.`);
      process.exit(1);
    }
    user = await prisma.user.create({
      data: { email, passwordHash: await hashPassword(password), firstName, lastName },
    });
    console.log(`Created User ${user.id} (${email}).`);
  } else {
    console.log(`Found existing User ${user.id} (${email}).`);
  }

  const platformUser = await prisma.platformUser.upsert({
    where: { userId: user.id },
    update: { username, role, isActive: true },
    create: { userId: user.id, username, role, isActive: true },
  });

  console.log(`Granted ${role} to username "${username}" (${email}, PlatformUser ${platformUser.id}).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
