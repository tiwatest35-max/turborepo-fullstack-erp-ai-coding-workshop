import { type ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { User } from '@erp/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env.js';
import type { PrismaService } from '../database/prisma.service.js';
import { type AuthenticatedRequest, Public, Roles, StoreScoped } from './auth.decorators.js';
import { AuthGuard } from './auth.guard.js';
import { createSessionToken, SESSION_COOKIE } from './session-token.js';

const secret = 'test-secret-that-is-at-least-32-characters';
const staff: User = {
  id: 'u1',
  email: 'staff@erp.local',
  name: 'Staff User',
  role: 'STORE_EMPLOYEE',
  storeId: 'B01',
};

class RoutesUnderTest {
  @Public()
  open() {}

  closed() {}

  @Roles('ADMIN')
  adminOnly() {}

  @StoreScoped()
  storeScoped() {}
}

function setup(user: User | null) {
  const findUnique = vi.fn().mockResolvedValue(user);
  const guard = new AuthGuard(
    new Reflector(),
    { user: { findUnique } } as unknown as PrismaService,
    { get: () => secret } as unknown as ConfigService<Env, true>,
  );

  // `params` mirrors how a real store-scoped route carries the target store id;
  // the guard resolves it from the request itself, before the handler runs.
  function run(route: keyof RoutesUnderTest, cookie?: string, params: Record<string, string> = {}) {
    const request = { headers: { cookie }, params } as unknown as AuthenticatedRequest;
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => RoutesUnderTest.prototype[route],
      getClass: () => RoutesUnderTest,
    } as unknown as ExecutionContext;
    return { request, result: guard.canActivate(context) };
  }

  return { run, findUnique };
}

const sessionCookie = (userId: string) => `${SESSION_COOKIE}=${createSessionToken(userId, secret)}`;

describe('AuthGuard', () => {
  it('lets anyone call a @Public() route', async () => {
    const { run } = setup(null);

    await expect(run('open').result).resolves.toBe(true);
  });

  it('rejects a protected route without a session', async () => {
    const { run } = setup(staff);

    await expect(run('closed').result).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a tampered cookie', async () => {
    const { run, findUnique } = setup(staff);

    await expect(
      run('closed', `${SESSION_COOKIE}=u1.9999999999999.forged`).result,
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('rejects a session whose user no longer exists', async () => {
    const { run } = setup(null);

    await expect(run('closed', sessionCookie('gone')).result).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('attaches the signed-in user to the request', async () => {
    const { run } = setup(staff);
    const { request, result } = run('closed', sessionCookie('u1'));

    await expect(result).resolves.toBe(true);
    expect(request.user).toEqual(staff);
  });

  it('rejects a user without the required role', async () => {
    const { run } = setup(staff);

    await expect(run('adminOnly', sessionCookie('u1')).result).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('allows a user with the required role', async () => {
    const { run } = setup({ ...staff, role: 'ADMIN' });

    await expect(run('adminOnly', sessionCookie('u1')).result).resolves.toBe(true);
  });

  it('lets a store employee act within their own store', async () => {
    const { run } = setup(staff); // storeId B01

    await expect(run('storeScoped', sessionCookie('u1'), { storeId: 'B01' }).result).resolves.toBe(
      true,
    );
  });

  it('rejects a store employee acting on another store', async () => {
    const { run } = setup(staff); // storeId B01

    await expect(
      run('storeScoped', sessionCookie('u1'), { storeId: 'B02' }).result,
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a store employee when the request carries no store id', async () => {
    const { run } = setup(staff); // storeId B01, request has no storeId param

    await expect(run('storeScoped', sessionCookie('u1')).result).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('lets a manager act on any store (not store-bound)', async () => {
    const { run } = setup({ ...staff, role: 'MANAGER', storeId: null });

    await expect(run('storeScoped', sessionCookie('u1'), { storeId: 'B02' }).result).resolves.toBe(
      true,
    );
  });

  it('lets an admin act on any store (not store-bound)', async () => {
    const { run } = setup({ ...staff, role: 'ADMIN', storeId: null });

    await expect(run('storeScoped', sessionCookie('u1'), { storeId: 'B02' }).result).resolves.toBe(
      true,
    );
  });
});
