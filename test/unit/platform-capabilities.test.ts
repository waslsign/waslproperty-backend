import { describe, expect, it } from 'vitest';
import { resolvePlatformCapabilities } from '../../src/platform/capabilities.js';

describe('platform capabilities', () => {
  it('PLATFORM_SUPER_ADMIN holds every capability including raw SQL write and unmasked SQL PII', () => {
    const caps = resolvePlatformCapabilities('PLATFORM_SUPER_ADMIN');
    expect(caps).toContain('database.sql.read');
    expect(caps).toContain('database.sql.write');
    expect(caps).toContain('database.sql.pii.unmasked');
    expect(caps).toContain('platformUsers.manage');
  });

  it('PLATFORM_ADMIN cannot execute raw SQL at all (read or write)', () => {
    const caps = resolvePlatformCapabilities('PLATFORM_ADMIN');
    expect(caps).not.toContain('database.sql.read');
    expect(caps).not.toContain('database.sql.write');
    expect(caps).not.toContain('database.sql.pii.unmasked');
    expect(caps).not.toContain('platformUsers.manage');
  });

  it('PLATFORM_SUPPORT cannot use SQL and cannot edit Data Explorer records', () => {
    const caps = resolvePlatformCapabilities('PLATFORM_SUPPORT');
    expect(caps).not.toContain('database.sql.read');
    expect(caps).not.toContain('database.sql.write');
    expect(caps).not.toContain('database.edit');
    expect(caps).toContain('database.view');
  });

  it('PLATFORM_DEVELOPER gets SQL read but never SQL write, by default', () => {
    const caps = resolvePlatformCapabilities('PLATFORM_DEVELOPER');
    expect(caps).toContain('database.sql.read');
    expect(caps).not.toContain('database.sql.write');
    expect(caps).not.toContain('database.sql.pii.unmasked');
  });

  it('only PLATFORM_SUPER_ADMIN and PLATFORM_ADMIN hold organisations.manage/users.manage', () => {
    expect(resolvePlatformCapabilities('PLATFORM_SUPER_ADMIN')).toContain('organisations.manage');
    expect(resolvePlatformCapabilities('PLATFORM_ADMIN')).toContain('organisations.manage');
    expect(resolvePlatformCapabilities('PLATFORM_SUPPORT')).not.toContain('organisations.manage');
    expect(resolvePlatformCapabilities('PLATFORM_DEVELOPER')).not.toContain('organisations.manage');
  });
});
