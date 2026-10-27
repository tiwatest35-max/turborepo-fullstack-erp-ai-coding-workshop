import { type ExecutionContext, ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Role, User } from '@erp/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env.js';
import { type AuthenticatedRequest } from '../auth/auth.decorators.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { PrismaService } from '../database/prisma.service.js';
import { AuditLogController } from './audit-log.controller.js';

/** Runs the real `AuthGuard` against `AuditLogController.list` for a signed-in user with this role. */
async function canList(role: Role): Promise<boolean> {
  const user: User = {
    id: 'u1',
    email: 'someone@erp.local',
    name: 'Someone',
    role,
    storeId: role === 'STORE_EMPLOYEE' ? 'st1' : null,
  };
  const guard = new AuthGuard(
    new Reflector(),
    { user: { findUnique: vi.fn().mockResolvedValue(user) } } as unknown as PrismaService,
    { get: () => 'test-secret-that-is-at-least-32-characters' } as unknown as ConfigService<
      Env,
      true
    >,
  );
  const context = {
    switchToHttp: () => ({
      getRequest: () => ({ headers: {}, user }) as AuthenticatedRequest,
    }),
    getHandler: () => AuditLogController.prototype.list,
    getClass: () => AuditLogController,
  } as unknown as ExecutionContext;

  try {
    return await guard.canActivate(context);
  } catch (error) {
    if (error instanceof ForbiddenException) return false;
    throw error;
  }
}

describe('AuditLogController permissions (NFR-01)', () => {
  it('lets managers and admins read the audit log and nobody else', async () => {
    expect(await canList('MANAGER')).toBe(true);
    expect(await canList('ADMIN')).toBe(true);
    expect(await canList('PURCHASING')).toBe(false);
    expect(await canList('STORE_EMPLOYEE')).toBe(false);
  });
});
