import { verifyAccessToken } from '../services/tokenService.js';
import { runWithRequestContext } from '../services/requestContext.js';

export function requireAuth(roles = [], options = {}) {
  const { allowIfMustChangePassword = false } = options;

  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing token' });
    try {
      const payload = verifyAccessToken(token);
      if (payload.must_change_password && !allowIfMustChangePassword) {
        return res.status(403).json({ error: 'Password change required' });
      }
      if (roles.length && !roles.includes(payload.role)) return res.status(403).json({ error: 'Forbidden' });
      const organizationId = payload.organization_id ?? payload.organizationId ?? null;
      runWithRequestContext({ userId: payload.id, organizationId }, () => {
        req.user = { ...payload, organization_id: organizationId };
        next();
      });
    } catch (e) {
      return res.status(401).json({ error: 'Invalid token' });
    }
  };
}
