import jwt from 'jsonwebtoken';
import { config } from '../config.js';

function buildSecretRotationList(token, secrets, keyIds) {
  const attempts = [];
  const decoded = jwt.decode(token, { complete: true });
  if (decoded?.header?.kid) {
    const idx = keyIds.indexOf(decoded.header.kid);
    if (idx !== -1) {
      attempts.push({ secret: secrets[idx], kid: keyIds[idx] });
    }
  }
  secrets.forEach((secret, idx) => {
    if (!attempts.some(entry => entry.secret === secret)) {
      attempts.push({ secret, kid: keyIds[idx] });
    }
  });
  return attempts;
}

export function signAccessToken(user) {
  return jwt.sign(
    {
      id: user.id,
      role: user.role,
      name: user.full_name,
      email: user.email || null,
      must_change_password: user.must_change_password,
      organization_id: user.organizationId,
      ui_variant: user.ui_variant
    },
    config.auth.jwtSecret,
    {
      expiresIn: config.auth.jwtExpires,
      keyid: config.auth.jwtKeyId
    }
  );
}

export function signRefreshToken(userId) {
  return jwt.sign(
    { id: userId },
    config.auth.refreshSecret,
    {
      expiresIn: config.auth.refreshExpires,
      keyid: config.auth.refreshKeyId
    }
  );
}

export function verifyAccessToken(token) {
  let lastError;
  for (const { secret } of buildSecretRotationList(token, config.auth.jwtSecrets, config.auth.jwtKeyIds)) {
    try {
      return jwt.verify(token, secret);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new jwt.JsonWebTokenError('Invalid token');
}

export function verifyRefreshToken(token) {
  let lastError;
  for (const { secret } of buildSecretRotationList(token, config.auth.refreshSecrets, config.auth.refreshKeyIds)) {
    try {
      return jwt.verify(token, secret);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new jwt.JsonWebTokenError('Invalid token');
}
