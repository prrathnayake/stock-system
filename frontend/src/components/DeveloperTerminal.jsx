import React, { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { api } from '../lib/api';
import { getAccessToken } from '../lib/auth';

const SOCKET_PATH = '/socket.io';

export default function DeveloperTerminal({ session, onClose }) {
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);
  const [lines, setLines] = useState([]);
  const socketRef = useRef(null);
  const textareaRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!session) return undefined;
    const baseUrl = import.meta.env.VITE_SOCKET_URL || api.defaults.baseURL || (typeof window !== 'undefined' ? window.location.origin : '');
    const socket = io(baseUrl, {
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
  }, [session]);

  useEffect(() => {
    if (!textareaRef.current) return;
    textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
  }, [lines]);

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!socketRef.current || !connected) return;
    const value = inputRef.current?.value ?? '';
    if (!value) return;
    socketRef.current.emit('terminal:input', `${value}\n`);
    setLines((prev) => [...prev, `> ${value}\n`]);
    inputRef.current.value = '';
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
      <pre className="terminal__output" ref={textareaRef} aria-live="polite">
        {lines.length === 0 ? 'Initialising session…\n' : lines.join('')}
      </pre>
      <form className="terminal__input" onSubmit={handleSubmit}>
        <label className="sr-only" htmlFor="terminal-command">Run command</label>
        <input
          id="terminal-command"
          ref={inputRef}
          type="text"
          placeholder={connected ? 'Enter shell command…' : 'Waiting for connection…'}
          disabled={!connected}
        />
        <button type="submit" className="button button--primary" disabled={!connected}>
          Send
        </button>
      </form>
    </div>
  );
}
