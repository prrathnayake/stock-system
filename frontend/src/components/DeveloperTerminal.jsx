import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { api } from '../lib/api';
import { getAccessToken } from '../lib/auth';

const SOCKET_PATH = '/socket.io';
const SOCKET_NAMESPACE = '/developer-terminal';

function resolveSocketBaseUrl() {
  const fallback = typeof window !== 'undefined' ? window.location.origin : '';
  const raw = import.meta.env.VITE_SOCKET_URL || api.defaults.baseURL || fallback;

  if (!raw) return null;

  try {
    const candidate = new URL(raw, fallback || 'http://localhost');
    return candidate.origin;
  } catch (error) {
    if (!fallback) return null;
    try {
      return new URL(String(raw), fallback).origin;
    } catch (innerError) {
      return fallback || null;
    }
  }
}

export default function DeveloperTerminal({ session, onClose }) {
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);
  const [lines, setLines] = useState([]);
  const [command, setCommand] = useState('');
  const socketRef = useRef(null);
  const outputRef = useRef(null);
  const inputRef = useRef(null);

  const shortcuts = useMemo(() => ([
    { label: 'List files', command: 'ls -al' },
    { label: 'Current path', command: 'pwd' },
    { label: 'Check disk', command: 'df -h' },
    { label: 'Node version', command: 'node -v' }
  ]), []);

  const endpoint = useMemo(() => {
    const baseUrl = resolveSocketBaseUrl();
    if (!baseUrl) return null;
    return `${baseUrl.replace(/\/$/, '')}${SOCKET_NAMESPACE}`;
  }, []);

  useEffect(() => {
    if (!session) return undefined;
    if (!endpoint) {
      setError('Unable to resolve maintenance shell endpoint.');
      return undefined;
    }
    const socket = io(endpoint, {
      path: SOCKET_PATH,
      transports: ['websocket'],
      auth: {
        sessionId: session.session_id,
        token: session.token,
        accessToken: getAccessToken()
      }
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      setError(null);
      setLines((prev) => [...prev, '[connected to maintenance shell]\n']);
    });

    socket.on('terminal:data', (chunk) => {
      setLines((prev) => [...prev, chunk]);
    });

    socket.on('terminal:exit', (code) => {
      const suffix = typeof code === 'number' ? ` (code ${code})` : '';
      setLines((prev) => [...prev, `\n[session ended${suffix}]\n`]);
      setConnected(false);
    });

    socket.on('disconnect', () => {
      setConnected(false);
    });

    socket.on('connect_error', (err) => {
      setError(err?.message || 'Unable to connect to maintenance shell.');
      setConnected(false);
    });

    return () => {
      socket.disconnect();
    };
  }, [endpoint, session]);

  useEffect(() => {
    if (!outputRef.current) return;
    outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [lines]);

  useEffect(() => {
    if (!connected) return;
    inputRef.current?.focus();
  }, [connected]);

  const sendCommand = useCallback((value) => {
    const trimmed = value?.trim();
    if (!trimmed) return;
    if (!socketRef.current || !connected) return;
    socketRef.current.emit('terminal:input', `${trimmed}\n`);
    setLines((prev) => [...prev, `$ ${trimmed}\n`]);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, [connected]);

  const handleSubmit = (event) => {
    event.preventDefault();
    sendCommand(command);
    setCommand('');
  };

  const handleShortcut = (value) => {
    sendCommand(value);
    setCommand('');
  };

  return (
    <div className="terminal">
      <div className="terminal__header">
        <strong>Web terminal session</strong>
        <div className="terminal__status">
          <span className={`terminal__indicator${connected ? ' terminal__indicator--online' : ''}`} aria-hidden="true" />
          <span>{connected ? 'Connected' : 'Disconnected'}</span>
        </div>
        <div className="terminal__actions">
          <button type="button" className="button button--ghost button--small" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
      {error && <div className="banner banner--danger">{error}</div>}
      <div className="terminal__output">
        <div className="terminal__shortcuts" role="group" aria-label="Terminal shortcuts">
          {shortcuts.map((item) => (
            <button
              key={item.command}
              type="button"
              className="button button--ghost button--small terminal__shortcut"
              onClick={() => handleShortcut(item.command)}
              title={`Run \`${item.command}\``}
              disabled={!connected}
            >
              {item.label}
            </button>
          ))}
        </div>
        <pre className="terminal__log" ref={outputRef} aria-live="polite">
          {lines.length === 0 ? 'Initialising session…\n' : lines.join('')}
        </pre>
        <form className="terminal__input" onSubmit={handleSubmit}>
          <label className="sr-only" htmlFor="terminal-command">Run command</label>
          <span className="terminal__prompt" aria-hidden="true">
            {connected ? '$' : '…'}
          </span>
          <input
            id="terminal-command"
            ref={inputRef}
            className="terminal__prompt-input"
            type="text"
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            placeholder={connected ? '' : 'Waiting for connection…'}
            disabled={!connected}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck="false"
          />
        </form>
      </div>
    </div>
  );
}
