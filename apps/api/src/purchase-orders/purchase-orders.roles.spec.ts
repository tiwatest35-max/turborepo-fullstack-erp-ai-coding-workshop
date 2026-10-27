import { type ExecutionContext, ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Role, User } from '@erp/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env.js';
import { type AuthenticatedRequest } from '../auth/auth.decorators.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { PrismaService } from '../database/prisma.service.js';
import { PurchaseOrdersController } from './purchase-orders.controller.js';

type Method = 'list' | 'get' | 'create' | 'update' | 'submit' | 'approve' | 'reject' | 'cancel';

/** Runs the real `AuthGuard` against one controller method for a signed-in user with this role. */
async function canCall(role: Role, method: Method): Promise<boolean> {
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
    getHandler: () => PurchaseOrdersController.prototype[method],
    getClass: () => PurchaseOrdersController,
  } as unknown as ExecutionContext;

  try {
    return await guard.canActivate(context);
  } catch (error) {
    if (error instanceof ForbiddenException) return false;
    throw error;
  }
}

describe('PurchaseOrdersController permissions (NFR-01)', () => {
  it.each(['create', 'update', 'submit'] as const)(
    'lets only a purchasing officer %s a purchase order',
    async (method) => {
      expect(await canCall('PURCHASING', method)).toBe(true);
      expect(await canCall('MANAGER', method)).toBe(false);
      expect(await canCall('ADMIN', method)).toBe(false);
      expect(await canCall('STORE_EMPLOYEE', method)).toBe(false);
    },
  );

  it.each(['approve', 'reject'] as const)('lets only a manager %s a purchase order', async (method) => {
    expect(await canCall('MANAGER', method)).toBe(true);
    expect(await canCall('PURCHASING', method)).toBe(false);
    expect(await canCall('ADMIN', method)).toBe(false);
    expect(await canCall('STORE_EMPLOYEE', method)).toBe(false);
  });

  it('lets purchasing officers and managers cancel, and the handler narrows purchasing to the creator', async () => {
    expect(await canCall('PURCHASING', 'cancel')).toBe(true);
    expect(await canCall('MANAGER', 'cancel')).toBe(true);
    expect(await canCall('ADMIN', 'cancel')).toBe(false);
    expect(await canCall('STORE_EMPLOYEE', 'cancel')).toBe(false);
  });

  it.each(['list', 'get'] as const)(
    'lets purchasing, managers and admins %s purchase orders but not store employees',
    async (method) => {
      expect(await canCall('PURCHASING', method)).toBe(true);
      expect(await canCall('MANAGER', method)).toBe(true);
      expect(await canCall('ADMIN', method)).toBe(true);
      expect(await canCall('STORE_EMPLOYEE', method)).toBe(false);
    },
  );
});
