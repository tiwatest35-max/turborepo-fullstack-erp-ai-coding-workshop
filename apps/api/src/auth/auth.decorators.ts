import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Role, User } from '@erp/contracts';
import type { Request } from 'express';

export const IS_PUBLIC_KEY = 'auth:isPublic';
export const ROLES_KEY = 'auth:roles';
export const STORE_SCOPED_KEY = 'auth:storeScoped';

/** Every route requires a signed-in user unless it (or its controller) is marked `@Public()`. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Only users with one of these roles may call the route, e.g. `@Roles('ADMIN')`. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/**
 * Marks a route as acting on a single store. A store-bound user (one with a
 * `storeId`) may only act within their own store; the guard rejects a mismatch.
 * Users that are not store-bound (ADMIN, MANAGER) bypass the check. The target
 * store is read from `request.targetStoreId`, which the route populates from its
 * input before the guard runs.
 */
export const StoreScoped = () => SetMetadata(STORE_SCOPED_KEY, true);

/**
 * The request after `AuthGuard` has run. `user` is unset on public routes
 * without a session. `targetStoreId` is set by store-scoped routes so the guard
 * can compare it against the user's own store.
 */
export type AuthenticatedRequest = Request & { user?: User; targetStoreId?: string };

/** The signed-in user, set by `AuthGuard`. Use as a parameter decorator next to `@Implement(...)`. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) =>
    ctx.switchToHttp().getRequest<AuthenticatedRequest>().user,
);
