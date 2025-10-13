import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import path from 'path';
import { existsSync } from 'fs';

const SESSION_TTL_MS = 5 * 60 * 1000;
const sessions = new Map();

function now() {
  return Date.now();
}

function parseArgString(value = '') {
  if (!value.trim()) return [];
  return value
    .match(/(?:[^\s'"`]+|"[^"]*"|'[^']*')+/g)
    ?.map((token) => token.replace(/^['"]|['"]$/g, '')) ?? [];
}

function resolveShellConfiguration() {
  const defaultShell = process.platform === 'win32' ? 'cmd.exe' : '/bin/bash';
  const shell = (process.env.DEVELOPER_TERMINAL_SHELL || defaultShell).trim();
  const explicitArgs = parseArgString(process.env.DEVELOPER_TERMINAL_ARGS);
  const args = explicitArgs.length > 0
    ? explicitArgs
    : (process.platform === 'win32' ? [] : ['-i']);

  const configuredCwd = (process.env.DEVELOPER_TERMINAL_CWD || '').trim();
  const defaultCwdCandidate = path.resolve(process.cwd(), '..');
  const defaultCwd = existsSync(path.join(defaultCwdCandidate, 'docker-compose.yml'))
    ? defaultCwdCandidate
    : process.cwd();
  const cwd = configuredCwd ? path.resolve(configuredCwd) : defaultCwd;

  const env = { ...process.env };
  if (!env.TERM) {
    env.TERM = 'xterm-256color';
  }

  return { shell, args, cwd, env };
}

function buildShellProcess() {
  const config = resolveShellConfiguration();
  const { env, shell, args, cwd } = config;
  const child = spawn(shell, args, {
    env,
    cwd,
    stdio: 'pipe'
  });
  child.stdin.setDefaultEncoding('utf-8');
  child.stdout?.setEncoding?.('utf-8');
  child.stderr?.setEncoding?.('utf-8');
  return { child, config: { shell, args, cwd } };
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
    shell: null,
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
  const { child, config } = buildShellProcess();
  session.process = child;
  session.shell = config;
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
