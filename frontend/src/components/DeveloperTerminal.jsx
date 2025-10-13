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

function isArrayBufferView(value) {
  return typeof ArrayBuffer !== 'undefined'
    && typeof ArrayBuffer.isView === 'function'
    && ArrayBuffer.isView(value);
}

export default function DeveloperTerminal({ session, onClose }) {
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);
  const [entries, setEntries] = useState([]);
  const [command, setCommand] = useState('');
  const socketRef = useRef(null);
  const outputRef = useRef(null);
  const inputRef = useRef(null);
  const decoderRef = useRef(null);
  const lineCounterRef = useRef(0);

  const shortcuts = useMemo(() => ([
    { label: 'List files', command: 'ls -al' },
    { label: 'Current path', command: 'pwd' },
    { label: 'Check disk', command: 'df -h' },
    { label: 'Node version', command: 'node -v' },
    { label: 'System uptime', command: 'uptime' },
    { label: 'Memory usage', command: 'free -h' },
    { label: 'List processes', command: 'ps aux | head -n 10' }
  ]), []);

  const appendLine = useCallback((kind, value) => {
    if (value === null || typeof value === 'undefined') return;

    let text;
    if (typeof value === 'string') {
      text = value;
    } else if (typeof TextDecoder !== 'undefined' && (value instanceof ArrayBuffer || isArrayBufferView(value))) {
      if (!decoderRef.current) {
        decoderRef.current = new TextDecoder();
      }
      let view;
      if (value instanceof ArrayBuffer) {
        view = new Uint8Array(value);
      } else if (value?.buffer instanceof ArrayBuffer) {
        view = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      }
      text = view ? decoderRef.current.decode(view) : String(value);
    } else {
      text = String(value);
    }

    if (typeof text !== 'string') {
      text = String(text);
    }

    const normalized = text.replace(/\r/g, '');
    if (normalized.length === 0) {
      return;
    }

    lineCounterRef.current += 1;
    setEntries((prev) => [...prev, { id: lineCounterRef.current, kind, text: normalized }]);
  }, []);

  const endpoint = useMemo(() => {
    const baseUrl = resolveSocketBaseUrl();
    if (!baseUrl) return null;
    return `${baseUrl.replace(/\/$/, '')}${SOCKET_NAMESPACE}`;
  }, []);

  useEffect(() => {
    lineCounterRef.current = 0;
    setEntries([]);
  }, [session?.session_id]);

  useEffect(() => {
    if (!session) return undefined;
    if (!endpoint) {
      setError('Unable to resolve maintenance shell endpoint.');
      appendLine('status', 'Unable to resolve maintenance shell endpoint.');
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
      appendLine('status', 'Connected to maintenance shell.');
    });

    socket.on('terminal:data', (chunk) => {
      appendLine('output', chunk);
    });

    socket.on('terminal:exit', (code) => {
      const suffix = typeof code === 'number' ? ` (code ${code})` : '';
      appendLine('status', `Session ended${suffix}.`);
      setConnected(false);
    });

    socket.on('disconnect', (reason) => {
      setConnected(false);
      const message = typeof reason === 'string' && reason ? reason : 'Connection closed.';
      appendLine('status', `Disconnected: ${message}`);
    });

    socket.on('connect_error', (err) => {
      setError(err?.message || 'Unable to connect to maintenance shell.');
      setConnected(false);
      appendLine('status', `Connect error: ${err?.message || 'Unable to connect to maintenance shell.'}`);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [appendLine, endpoint, session]);

  useEffect(() => {
    if (!outputRef.current) return;
    outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [entries]);

  useEffect(() => {
    if (!connected) return;
    inputRef.current?.focus();
  }, [connected]);

  const sendCommand = useCallback((value) => {
    const trimmed = value?.trim();
    if (!trimmed) return;
    if (!socketRef.current || !connected) return;
    socketRef.current.emit('terminal:input', `${trimmed}\n`);
    appendLine('input', trimmed);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, [appendLine, connected]);

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
        <div className="terminal__log" ref={outputRef} role="log" aria-live="polite">
          {entries.length === 0 ? (
            <div className="terminal__line terminal__line--status">
              <span className="terminal__line-badge">Status</span>
              <pre>Initialising session…</pre>
            </div>
          ) : (
            entries.map((entry) => {
              const label = entry.kind === 'input'
                ? 'Request'
                : entry.kind === 'output'
                  ? 'Response'
                  : 'Status';
              return (
                <div key={entry.id} className={`terminal__line terminal__line--${entry.kind}`}>
                  <span className="terminal__line-badge">{label}</span>
                  <pre>
                    {entry.kind === 'input' ? (
                      <>
                        <span className="terminal__prompt-symbol" aria-hidden="true">$</span>
                        <span> {entry.text}</span>
                      </>
                    ) : entry.text}
                  </pre>
                </div>
              );
            })
          )}
        </div>
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
