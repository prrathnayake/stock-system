import { UserActivity } from '../db.js';
import { getOrganizationId, getUserId } from './requestContext.js';

export async function recordActivity({
  organizationId,
  userId,
  action,
  entityType = null,
  entityId = null,
  description = null,
  metadata = null
}, options = {}) {
  const effectiveOrganizationId = organizationId ?? getOrganizationId();
  const effectiveUserId = userId ?? getUserId();
  if (!effectiveOrganizationId || !action) {
    return null;
  }
  try {
    return await UserActivity.create({
      organizationId: effectiveOrganizationId,
      userId: effectiveUserId ?? null,
      action,
      entity_type: entityType,
      entity_id: entityId ? String(entityId) : null,
      description,
      metadata
    }, options);
  } catch (error) {
    console.error('[activity] failed to record activity', error);
    return null;
  }
}

export function presentActivity(activity) {
  if (!activity) return null;
  return {
    id: activity.id,
    action: activity.action,
    description: activity.description,
    entity_type: activity.entity_type,
    entity_id: activity.entity_id,
    metadata: activity.metadata,
    performed_at: activity.createdAt,
    user: activity.user ? {
      id: activity.user.id,
      name: activity.user.full_name,
      email: activity.user.email
    } : null
  };
}
