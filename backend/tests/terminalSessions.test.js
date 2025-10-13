import { describe, expect, it } from 'vitest';
import { createTerminalSession, consumeTerminalSession, terminateSession } from '../src/services/terminalSessions.js';

describe('developer terminal sessions', () => {
  it('streams command output from the maintenance shell', async () => {
    const { session_id, token } = createTerminalSession({ userId: 'tester-1' });
    const session = consumeTerminalSession({ sessionId: session_id, token, userId: 'tester-1' });
    expect(session).toBeTruthy();
    expect(session.shell).toBeTruthy();

    const child = session.process;
    expect(child).toBeTruthy();

    let buffer = '';

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timeout waiting for terminal output')), 5000);

      const cleanup = (handler) => {
        child.stdout?.off?.('data', handler);
        child.stderr?.off?.('data', handler);
        child.stdout?.removeListener?.('data', handler);
        child.stderr?.removeListener?.('data', handler);
      };

      const handleChunk = (chunk) => {
        buffer += chunk.toString();
        if (buffer.includes('terminal-session-ready')) {
          clearTimeout(timeout);
          cleanup(handleChunk);
          resolve();
        }
      };

      child.stdout?.on('data', handleChunk);
      child.stderr?.on('data', handleChunk);

      try {
        child.stdin.write('echo terminal-session-ready\n');
      } catch (error) {
        clearTimeout(timeout);
        cleanup(handleChunk);
        reject(error);
      }
    });

    terminateSession(session.id);
    expect(buffer).toContain('terminal-session-ready');
  });
});
