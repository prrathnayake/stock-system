import nodemailer from 'nodemailer';
import { config } from '../config.js';

let transporterPromise = null;
let lastTransportError = null;

function buildTransport() {
  const tls = config.mail.rejectUnauthorized
    ? undefined
    : { rejectUnauthorized: false };

  if (config.mail.url) {
    return nodemailer.createTransport(config.mail.url, { tls });
  }

  return nodemailer.createTransport({
    host: config.mail.host,
    port: config.mail.port,
    secure: config.mail.secure,
    auth: config.mail.user && config.mail.pass
      ? { user: config.mail.user, pass: config.mail.pass }
      : undefined,
    tls
  });
}

function markTransportError(code) {
  lastTransportError = code;
}

function hasTransportConfiguration() {
  return Boolean((config.mail.url || '').trim() || (config.mail.host || '').trim());
}

async function createTransporter() {
  if (!config.mail.enabled) {
    markTransportError('mail-disabled');
    return null;
  }
  if (transporterPromise) {
    return transporterPromise;
  }
  transporterPromise = (async () => {
    if (!hasTransportConfiguration()) {
      console.error('[mail] Mail is enabled but no MAIL_HOST or MAIL_URL is configured.');
      markTransportError('transport-not-configured');
      return null;
    }
    try {
      const transport = buildTransport();
      try {
        await transport.verify();
      } catch (error) {
        const level = config.env === 'production' ? 'error' : 'warn';
        console[level]('[mail] Transport verification failed, continuing anyway:', error.message);
      }
      lastTransportError = null;
      return transport;
    } catch (error) {
      console.error('[mail] Transport initialisation failed:', error.message);
      markTransportError('transport-init-failed');
      return null;
    }
  })();
  const transport = await transporterPromise;
  if (!transport) {
    transporterPromise = null;
  }
  return transport;
}

export async function sendEmail({ to, subject, text, html }) {
  if (!config.mail.enabled) {
    if (config.env !== 'production') {
      console.info('[mail] Email delivery disabled. Skipping send for:', subject);
    }
    markTransportError('mail-disabled');
    return { delivered: false, disabled: true };
  }
  const transport = await createTransporter();
  if (!transport) {
    return { delivered: false, error: lastTransportError || 'transport-unavailable' };
  }
  try {
    await transport.sendMail({
      from: config.mail.from,
      to,
      subject,
      text,
      html
    });
    lastTransportError = null;
    return { delivered: true };
  } catch (error) {
    console.error('[mail] Failed to send email:', error.message);
    markTransportError(error.message || 'send-failed');
    transporterPromise = null;
    return { delivered: false, error: error.message };
  }
}

export function resetTransportForTests() {
  transporterPromise = null;
  lastTransportError = null;
}

export function __getLastTransportError() {
  return lastTransportError;
}
