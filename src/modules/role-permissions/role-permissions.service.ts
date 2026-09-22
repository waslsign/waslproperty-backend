import { PropertyRole, type PrismaClient } from '@prisma/client';
import { ValidationError } from '../../errors/AppError.js';
import { recordActivity } from '../activity/activity.js';
import { AuthorizationService } from '../authorization/authorization.service.js';
import {
  CAPABILITIES,
  CAPABILITY_GROUPS,
  DEFAULT_ROLE_CAPABILITIES,
  isCapability,
  type Capability,
} from '../authorization/capabilities.js';
import type { UpdateRolePermissionsInput } from './role-permissions.schemas.js';

export interface RoleCapabilityRow {
  capability: Capability;
  /** WaslProp's system default for this role, before any organisation override. */
  defaultGranted: boolean;
  /** The effective value this organisation actually uses today (default,
   * unless overridden below). */
  granted: boolean;
  /** True when `granted` differs from `defaultGranted` — i.e. this
   * organisation has explicitly overridden this capability for this role. */
  isOverride: boolean;
}

export interface RolePermissionsSummary {
  role: PropertyRole;
  capabilities: RoleCapabilityRow[];
}

/** The 7 PropertyRole values TENANT/RESIDENT excluded on purpose here —
 * see capabilities.ts's own doc comment: their access is governed by
 * separate, narrower resident-specific logic, not this capability system,
 * so there is nothing meaningful to configure for them in this editor. */
const CONFIGURABLE_ROLES: PropertyRole[] = [
  'PROPERTY_MANAGER',
  'FACILITY_MANAGER',
  'AGENT',
  'COMMITTEE_MEMBER',
  'OWNER',
];

export class RolePermissionsService {
  private readonly authz: AuthorizationService;

  constructor(private readonly prisma: PrismaClient) {
    this.authz = new AuthorizationService(prisma);
  }

  get configurableRoles(): PropertyRole[] {
    return CONFIGURABLE_ROLES;
  }

  get capabilityGroups() {
    return CAPABILITY_GROUPS;
  }

  async getSummary(organisationId: string): Promise<RolePermissionsSummary[]> {
    const overrides = await this.prisma.organisationRolePermission.findMany({
      where: { organisationId, role: { in: CONFIGURABLE_ROLES } },
      select: { role: true, capability: true, granted: true },
    });
    const overridesByRole = new Map<PropertyRole, Map<string, boolean>>();
    for (const o of overrides) {
      if (!isCapability(o.capability)) continue;
      const forRole = overridesByRole.get(o.role) ?? new Map<string, boolean>();
      forRole.set(o.capability, o.granted);
      overridesByRole.set(o.role, forRole);
    }

    return CONFIGURABLE_ROLES.map((role) => {
      const defaults = new Set(DEFAULT_ROLE_CAPABILITIES[role]);
      const roleOverrides = overridesByRole.get(role);
      const capabilities: RoleCapabilityRow[] = CAPABILITIES.map((capability) => {
        const defaultGranted = defaults.has(capability);
        const override = roleOverrides?.get(capability);
        const granted = override ?? defaultGranted;
        return { capability, defaultGranted, granted, isOverride: override !== undefined };
      });
      return { role, capabilities };
    });
  }

  /**
   * Full replacement of one role's overrides, in a single transaction —
   * rows whose requested `granted` matches the system default are deleted
   * (never stored — an override-only table stays free of no-op rows), and
   * rows that genuinely deviate are upserted. Records exactly one
   * ROLE_PERMISSIONS_UPDATED activity event summarising what changed, not
   * one event per capability.
   */
  async updateRole(
    organisationId: string,
    actorUserId: string,
    role: PropertyRole,
    input: UpdateRolePermissionsInput,
  ): Promise<RoleCapabilityRow[]> {
    this.assertConfigurable(role);
    const defaults = new Set(DEFAULT_ROLE_CAPABILITIES[role]);

    const toUpsert: Array<{ capability: Capability; granted: boolean }> = [];
    const toDelete: Capability[] = [];
    for (const { capability, granted } of input.overrides) {
      if (defaults.has(capability) === granted) {
        toDelete.push(capability);
      } else {
        toUpsert.push({ capability, granted });
      }
    }

    const changedCapabilities = [...toUpsert.map((o) => o.capability), ...toDelete];

    await this.prisma.$transaction(async (tx) => {
      for (const { capability, granted } of toUpsert) {
        await tx.organisationRolePermission.upsert({
          where: { organisationId_role_capability: { organisationId, role, capability } },
          create: { organisationId, role, capability, granted },
          update: { granted },
        });
      }
      if (toDelete.length > 0) {
        await tx.organisationRolePermission.deleteMany({
          where: { organisationId, role, capability: { in: toDelete } },
        });
      }

      if (changedCapabilities.length > 0) {
        await recordActivity(tx, {
          organisationId,
          actorUserId,
          eventType: 'ROLE_PERMISSIONS_UPDATED',
          entityType: 'OrganisationRolePermission',
          entityId: role,
          title: `${formatRoleLabel(role)} permissions updated`,
          description: `Changed: ${changedCapabilities.join(', ')}`,
        });
      }
    });

    const caps = await this.authz.getEffectiveRoleCapabilities(organisationId, role);
    return CAPABILITIES.map((capability) => ({
      capability,
      defaultGranted: defaults.has(capability),
      granted: caps.has(capability),
      isOverride: caps.has(capability) !== defaults.has(capability),
    }));
  }

  /** Deletes every override row for this role — the organisation reverts
   * to exactly WaslProp's system defaults, and (per the capability
   * catalogue's own design) will automatically pick up any future
   * capability added to DEFAULT_ROLE_CAPABILITIES without further action. */
  async resetRole(
    organisationId: string,
    actorUserId: string,
    role: PropertyRole,
  ): Promise<RoleCapabilityRow[]> {
    this.assertConfigurable(role);
    const defaults = new Set(DEFAULT_ROLE_CAPABILITIES[role]);

    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.organisationRolePermission.deleteMany({
        where: { organisationId, role },
      });
      if (count > 0) {
        await recordActivity(tx, {
          organisationId,
          actorUserId,
          eventType: 'ROLE_PERMISSIONS_UPDATED',
          entityType: 'OrganisationRolePermission',
          entityId: role,
          title: `${formatRoleLabel(role)} permissions reset to defaults`,
        });
      }
    });

    return CAPABILITIES.map((capability) => ({
      capability,
      defaultGranted: defaults.has(capability),
      granted: defaults.has(capability),
      isOverride: false,
    }));
  }

  private assertConfigurable(role: PropertyRole) {
    if (!CONFIGURABLE_ROLES.includes(role)) {
      throw new ValidationError(
        `${role} has no configurable permissions — its access is governed by separate resident-specific logic, not this capability system`,
      );
    }
  }
}

function formatRoleLabel(role: string): string {
  return role
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
