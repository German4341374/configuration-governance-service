import type { FastifyRequest } from 'fastify';
import { AppError } from './errors.js';
import type { Actor, Role } from './types.js';

const roles: Role[] = ['viewer', 'editor', 'approver', 'deployer', 'admin'];
const permissions: Record<Role, ReadonlySet<string>> = {
  viewer: new Set(['read']),
  editor: new Set(['read', 'upload']),
  approver: new Set(['read', 'approve']),
  deployer: new Set(['read', 'deploy']),
  admin: new Set(['read', 'upload', 'approve', 'deploy'])
};

export function actorFromRequest(
  request: FastifyRequest,
  authMode: 'demo' | 'trusted_headers'
): Actor {
  const actorHeader = request.headers['x-actor'];
  const roleHeader = request.headers['x-role'];
  if (authMode === 'demo' && (!actorHeader || !roleHeader))
    return { name: 'demo-admin', role: 'admin' };
  if (typeof actorHeader !== 'string' || !actorHeader.trim()) {
    throw new AppError(401, 'ACTOR_REQUIRED', 'X-Actor header is required');
  }
  if (typeof roleHeader !== 'string' || !roles.includes(roleHeader as Role)) {
    throw new AppError(403, 'INVALID_ROLE', 'X-Role header is missing or invalid');
  }
  return { name: actorHeader.trim().slice(0, 100), role: roleHeader as Role };
}

export function requirePermission(
  actor: Actor,
  permission: 'read' | 'upload' | 'approve' | 'deploy'
): void {
  if (!permissions[actor.role].has(permission)) {
    throw new AppError(403, 'FORBIDDEN', `Role '${actor.role}' cannot perform '${permission}'`);
  }
}
