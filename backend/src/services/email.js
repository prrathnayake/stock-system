import nodemailer from 'nodemailer';
import { config } from '../config.js';

let transporterPromise = null;

async function createTransporter() {
  if (!config.mail.enabled) {
    return null;
  }
  if (transporterPromise) {
    return transporterPromise;
  }
  transporterPromise = (async () => {
    try {
      const transport = nodemailer.createTransport({
        host: config.mail.host,
        port: config.mail.port,
        secure: config.mail.secure,
        auth: config.mail.user && config.mail.pass
          ? { user: config.mail.user, pass: config.mail.pass }
          : undefined
      });
      await transport.verify();
      return transport;
    } catch (error) {
      console.error('[mail] Transport initialisation failed:', error.message);
      return null;
    }
  })();
  return transporterPromise;
}

export async function sendEmail({ to, subject, text, html }) {
  if (!config.mail.enabled) {
    if (config.env !== 'production') {
      console.info('[mail] Email delivery disabled. Skipping send for:', subject);
    }
    return { delivered: false, disabled: true };
  }
  const transport = await createTransporter();
  if (!transport) {
    return { delivered: false, error: 'transport-unavailable' };
  }
  try {
    await transport.sendMail({
      from: config.mail.from,
      to,
      subject,
      text,
      html
    });
    return { delivered: true };
  } catch (error) {
    console.error('[mail] Failed to send email:', error.message);
    return { delivered: false, error: error.message };
  }
}

export function resetTransportForTests() {
  transporterPromise = null;
}
