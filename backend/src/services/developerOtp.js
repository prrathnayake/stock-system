const OTP_TTL_MS = 5 * 60 * 1000;

const otpStore = new Map();

function buildKey(userId, purpose) {
  return `${userId}:${purpose}`;
}

function purgeExpiredOtps(now = Date.now()) {
  for (const [key, entry] of otpStore.entries()) {
    if (!entry || typeof entry.expiresAt !== 'number') {
      otpStore.delete(key);
      continue;
    }
    if (entry.expiresAt <= now) {
      otpStore.delete(key);
    }
  }
}

export function issueDeveloperOtp({ userId, purpose = 'general', now = Date.now() }) {
  if (!userId) {
    throw new Error('userId is required to issue a developer OTP');
  }
  const normalizedPurpose = typeof purpose === 'string' && purpose.trim() ? purpose.trim().toLowerCase() : 'general';
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = now + OTP_TTL_MS;
  purgeExpiredOtps(now);
  otpStore.set(buildKey(userId, normalizedPurpose), { code, expiresAt });
  return { code, expiresAt };
}

export function verifyDeveloperOtp({ userId, purpose = 'general', code, consume = true, now = Date.now() }) {
  if (!userId) {
    return { ok: false, reason: 'missing-user' };
  }
  if (typeof code !== 'string' || !code.trim()) {
    return { ok: false, reason: 'missing-code' };
  }
  const normalizedPurpose = typeof purpose === 'string' && purpose.trim() ? purpose.trim().toLowerCase() : 'general';
  const key = buildKey(userId, normalizedPurpose);
  const entry = otpStore.get(key);
  if (!entry) {
    purgeExpiredOtps(now);
    return { ok: false, reason: 'not-found' };
  }
  purgeExpiredOtps(now);
  if (entry.expiresAt <= now) {
    otpStore.delete(key);
    return { ok: false, reason: 'expired' };
  }
  const trimmedCode = code.trim();
  if (entry.code !== trimmedCode) {
    return { ok: false, reason: 'mismatch' };
  }
  if (consume) {
    otpStore.delete(key);
  }
  return { ok: true, expiresAt: entry.expiresAt };
}

export function resetDeveloperOtps() {
  otpStore.clear();
}

export { OTP_TTL_MS };
