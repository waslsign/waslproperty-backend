import { randomInt } from 'node:crypto';
import argon2 from 'argon2';

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain);
}

export function verifyPassword(hash: string, plain: string): Promise<boolean> {
  return argon2.verify(hash, plain);
}

// Excludes visually-ambiguous characters (0/O, 1/l/I) since this is meant
// to be read off a screen and typed or copy-pasted once, by a human.
const TEMP_PASSWORD_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%&*';

/** A one-time, cryptographically random temporary password — used only for
 * platform accounts created without an existing User to attach to (see
 * BackofficePlatformUsersService.grant). Never stored in plaintext; the
 * caller is responsible for displaying it exactly once and never logging
 * or persisting it anywhere but the immediate HTTP response. */
export function generateTemporaryPassword(length = 16): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += TEMP_PASSWORD_ALPHABET[randomInt(TEMP_PASSWORD_ALPHABET.length)];
  }
  return out;
}
