import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { User } from '@erp/contracts';
import { hashPassword } from '@erp/database';
import { call } from '@orpc/server';
import type { Response } from 'express';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../database/prisma.service.js';
import { AuthController } from './auth.controller.js';
import { SESSION_COOKIE, verifySessionToken } from './session-token.js';

const secret = 'test-secret-that-is-at-least-32-characters';
const admin: User = {
  id: 'u1',
  email: 'admin@erp.local',
  name: 'Admin User',
  role: 'ADMIN',
  storeId: null,
};

async function createController(findUnique = vi.fn()) {
  const moduleRef = await Test.createTestingModule({
    controllers: [AuthController],
    providers: [
      { provide: PrismaService, useValue: { user: { findUnique } } },
      {
        provide: ConfigService,
        useValue: { get: (key: string) => (key === 'AUTH_SECRET' ? secret : 'test') },
      },
    ],
  }).compile();
  return moduleRef.get(AuthController);
}

function fakeResponse() {
  return { cookie: vi.fn(), clearCookie: vi.fn() } as unknown as Response & {
    cookie: ReturnType<typeof vi.fn>;
    clearCookie: ReturnType<typeof vi.fn>;
  };
}

describe('AuthController', () => {
  let passwordHash: string;
  beforeAll(async () => {
    passwordHash = await hashPassword('password');
  });

  it('signs in and sets a signed session cookie', async () => {
    const controller = await createController(
      vi.fn().mockResolvedValue({ ...admin, passwordHash }),
    );
    const res = fakeResponse();

    await expect(
      call(controller.login(res), { email: 'Admin@erp.local', password: 'password' }),
    ).resolves.toEqual(admin);

    const [name, token, options] = res.cookie.mock.calls[0]!;
    expect(name).toBe(SESSION_COOKIE);
    expect(verifySessionToken(token, secret)).toBe('u1');
    expect(options).toMatchObject({ httpOnly: true, sameSite: 'lax' });
  });

  it('rejects a wrong password without setting a cookie', async () => {
    const controller = await createController(
      vi.fn().mockResolvedValue({ ...admin, passwordHash }),
    );
    const res = fakeResponse();

    await expect(
      call(controller.login(res), { email: 'admin@erp.local', password: 'wrong' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('rejects an unknown email', async () => {
    const controller = await createController(vi.fn().mockResolvedValue(null));

    await expect(
      call(controller.login(fakeResponse()), { email: 'nobody@erp.local', password: 'password' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('clears the cookie on logout', async () => {
    const controller = await createController();
    const res = fakeResponse();

    await call(controller.logout(res), undefined);

    expect(res.clearCookie).toHaveBeenCalledWith(SESSION_COOKIE, expect.any(Object));
  });

  it('returns the current user, or null when signed out', async () => {
    const controller = await createController();

    await expect(call(controller.me(admin), undefined)).resolves.toEqual({ user: admin });
    await expect(call(controller.me(undefined), undefined)).resolves.toEqual({ user: null });
  });
});
