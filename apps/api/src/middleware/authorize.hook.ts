import type { preHandlerHookHandler } from 'fastify';
import type { AuthUser } from '@hivekitchen/types';
import { ForbiddenError, UnauthorizedError } from '../common/errors.js';

type UserRole = AuthUser['role'];

export function authorize(roles: readonly UserRole[]): preHandlerHookHandler {
  if (roles.length === 0) throw new Error('authorize() called with empty roles array');
  return async (request) => {
    if (!request.user) {
      throw new UnauthorizedError('Authentication required');
    }
    if (!roles.includes(request.user.role)) {
      throw new ForbiddenError('Role not permitted for this resource');
    }
  };
}
