import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'crypto';

const MAX_EVENTS = 50;
const events = [];
let warnedAboutSecret = false;

function resolveSecret() {
  const explicitSecret = (process.env.TERMINAL_LOG_SECRET || '').trim();
  if (explicitSecret) {
    return explicitSecret;
  }
  const fallback = (process.env.DEVELOPER_API_KEY || '').trim();
  if (fallback) {
    if (!warnedAboutSecret) {
      console.warn('[terminal-audit] Using developer API key as audit log secret. Set TERMINAL_LOG_SECRET for dedicated encryption.');
      warnedAboutSecret = true;
    }
    return fallback;
  }
  if (!warnedAboutSecret) {
    console.warn('[terminal-audit] TERMINAL_LOG_SECRET is not set. Falling back to process secret.');
    warnedAboutSecret = true;
  }
  return 'stock-system-terminal-audit-fallback';
}

const SECRET_KEY = createHash('sha256').update(resolveSecret()).digest();

function encryptPayload(payload) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', SECRET_KEY, iv);
  const json = Buffer.from(JSON.stringify(payload), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(json), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    iv: iv.toString('base64'),
    content: ciphertext.toString('base64'),
    tag: authTag.toString('base64')
  };
}

function decryptPayload(envelope) {
  try {
    const iv = Buffer.from(envelope.iv, 'base64');
    const content = Buffer.from(envelope.content, 'base64');
    const tag = Buffer.from(envelope.tag, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', SECRET_KEY, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(content), decipher.final()]);
    return JSON.parse(decrypted.toString('utf8'));
  } catch (error) {
    console.error('[terminal-audit] Failed to decrypt audit entry', error);
    return null;
  }
}

export function recordTerminalEvent(event) {
  if (!event || typeof event !== 'object') return null;
  const timestamp = new Date().toISOString();
  const sessionId = event.session_id || null;
  const payload = {
    id: randomUUID(),
    timestamp,
    type: event.type || 'unknown',
    session_reference: event.session_reference || (sessionId ? sessionId.slice(0, 8) : undefined),
    session_id: sessionId || undefined,
    user_id: event.user_id || undefined,
    ip: event.ip || undefined,
    user_agent: event.user_agent || undefined,
    details: event.details || undefined,
    metadata: event.metadata || undefined
  };

  const envelope = encryptPayload(payload);
  events.unshift({ id: payload.id, envelope });
  if (events.length > MAX_EVENTS) {
    events.splice(MAX_EVENTS);
  }
  return payload;
}

export function getTerminalEvents() {
  return events
    .map((entry) => {
      const payload = decryptPayload(entry.envelope);
      if (!payload) {
        return {
          id: entry.id,
          timestamp: null,
          type: 'corrupt',
          session_reference: undefined,
          user_id: undefined,
          ip: undefined,
          user_agent: undefined,
          details: 'Unable to decrypt audit entry.'
        };
      }
      const { session_id: _sessionId, ...rest } = payload;
      return rest;
    });
}

export function clearTerminalEvents() {
  events.splice(0, events.length);
}
