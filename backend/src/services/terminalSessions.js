import { randomUUID } from 'crypto';
import { spawn } from 'child_process';

const SESSION_TTL_MS = 5 * 60 * 1000;
const sessions = new Map();

function now() {
  return Date.now();
}

function buildShellProcess() {
  const shell = process.env.DEVELOPER_TERMINAL_SHELL || '/bin/sh';
  const child = spawn(shell, [], {
    env: {
      PATH: process.env.PATH,
      NODE_ENV: process.env.NODE_ENV || 'development'
    },
    cwd: process.cwd(),
    stdio: 'pipe'
  });
  child.stdin.setDefaultEncoding('utf-8');
  return child;
}

export function createTerminalSession({ userId }) {
  const id = randomUUID();
  const token = randomUUID().replace(/-/g, '');
  const createdAt = now();
  const expiresAt = createdAt + SESSION_TTL_MS;

  const entry = {
    id,
    token,
    userId,
    createdAt,
    expiresAt,
    claimed: false,
    process: null,
    timeout: null
  };

  entry.timeout = setTimeout(() => {
    terminateSession(id);
  }, SESSION_TTL_MS);

  sessions.set(id, entry);

  return {
    session_id: id,
    token,
    issued_at: new Date(createdAt).toISOString(),
    expires_in: Math.floor((expiresAt - createdAt) / 1000)
  };
}

export function consumeTerminalSession({ sessionId, token, userId }) {
  const session = sessions.get(sessionId);
  if (!session) return null;
  if (session.token !== token) return null;
  if (session.userId !== userId) return null;
  if (session.claimed) return null;
  if (session.expiresAt < now()) {
    terminateSession(sessionId);
    return null;
  }
  session.claimed = true;
  session.process = buildShellProcess();
  return session;
}

export function terminateSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;
  sessions.delete(sessionId);
  if (session.timeout) {
    clearTimeout(session.timeout);
  }
  if (session.process) {
    try {
      session.process.kill('SIGTERM');
    } catch (error) {
      console.warn('[terminal] failed to terminate process', error);
    }
  }
}

export function getSession(sessionId) {
  return sessions.get(sessionId) || null;
}
