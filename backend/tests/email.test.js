import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sendMailMock = vi.fn();
const verifyMock = vi.fn();
const createTransportMock = vi.fn(() => ({
  sendMail: sendMailMock,
  verify: verifyMock
}));

vi.mock('nodemailer', () => ({
  default: { createTransport: createTransportMock }
}));

describe('email service', () => {
  let consoleErrorSpy;
  let consoleWarnSpy;
  let consoleInfoSpy;

  beforeEach(() => {
    vi.resetModules();
    sendMailMock.mockReset();
    verifyMock.mockReset();
    createTransportMock.mockClear();
    delete process.env.MAIL_ENABLED;
    delete process.env.MAIL_HOST;
    delete process.env.MAIL_URL;
    delete process.env.MAIL_USER;
    delete process.env.MAIL_PASS;
    delete process.env.MAIL_FROM;
    delete process.env.MAIL_PORT;
    delete process.env.MAIL_SECURE;
    delete process.env.MAIL_TLS_REJECT_UNAUTHORIZED;
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(async () => {
    const { resetTransportForTests } = await import('../src/services/email.js');
    resetTransportForTests();
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleInfoSpy.mockRestore();
  });

  it('skips delivery when mail transport is disabled', async () => {
    process.env.MAIL_ENABLED = 'false';
    const { sendEmail } = await import('../src/services/email.js');
    const result = await sendEmail({ to: 'user@example.com', subject: 'Test', text: 'Hello' });
    expect(result).toMatchObject({ delivered: false, disabled: true });
    expect(createTransportMock).not.toHaveBeenCalled();
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('enables delivery automatically when a host is provided', async () => {
    process.env.MAIL_HOST = 'smtp.example.com';
    process.env.MAIL_PORT = '2525';
    process.env.MAIL_USER = 'mailer';
    process.env.MAIL_PASS = 'secret';
    process.env.MAIL_FROM = 'no-reply@example.com';
    verifyMock.mockResolvedValueOnce(true);
    sendMailMock.mockResolvedValueOnce({});

    const { sendEmail, resetTransportForTests } = await import('../src/services/email.js');
    resetTransportForTests();
    const result = await sendEmail({ to: 'user@example.com', subject: 'Hello', text: 'Test message' });

    expect(createTransportMock).toHaveBeenCalledWith(expect.objectContaining({
      host: 'smtp.example.com',
      port: 2525,
      secure: false,
      auth: { user: 'mailer', pass: 'secret' }
    }));
    expect(createTransportMock.mock.calls[0][0].tls).toBeUndefined();
    expect(sendMailMock).toHaveBeenCalledWith({
      from: 'no-reply@example.com',
      to: 'user@example.com',
      subject: 'Hello',
      text: 'Test message',
      html: undefined
    });
    expect(result).toEqual({ delivered: true });
  });

  it('respects explicit MAIL_ENABLED=false even when host present', async () => {
    process.env.MAIL_ENABLED = 'false';
    process.env.MAIL_HOST = 'smtp.example.com';
    const { sendEmail } = await import('../src/services/email.js');
    const result = await sendEmail({ to: 'user@example.com', subject: 'Disabled', text: 'Test' });
    expect(result.disabled).toBe(true);
    expect(createTransportMock).not.toHaveBeenCalled();
  });

  it('reports configuration issues when enabled without transport details', async () => {
    process.env.MAIL_ENABLED = 'true';
    const { sendEmail, __getLastTransportError } = await import('../src/services/email.js');
    const result = await sendEmail({ to: 'ops@example.com', subject: 'Missing config', text: 'Test' });
    expect(result).toMatchObject({ delivered: false, error: 'transport-not-configured' });
    expect(__getLastTransportError()).toBe('transport-not-configured');
    expect(createTransportMock).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[mail] Mail is enabled but no MAIL_HOST or MAIL_URL is configured.'
    );
  });

  it('surfaces send errors from the transport', async () => {
    process.env.MAIL_HOST = 'smtp.example.com';
    process.env.MAIL_FROM = 'no-reply@example.com';
    sendMailMock.mockRejectedValueOnce(new Error('connection refused'));
    verifyMock.mockResolvedValueOnce(true);

    const { sendEmail, __getLastTransportError, resetTransportForTests } = await import('../src/services/email.js');
    resetTransportForTests();
    const result = await sendEmail({ to: 'user@example.com', subject: 'Hello', text: 'Body' });

    expect(result).toMatchObject({ delivered: false, error: 'connection refused' });
    expect(__getLastTransportError()).toBe('connection refused');
    expect(sendMailMock).toHaveBeenCalled();
  });
});
