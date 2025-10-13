import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { issueDeveloperOtp, resetDeveloperOtps, verifyDeveloperOtp, OTP_TTL_MS } from '../src/services/developerOtp.js';

describe('developer OTP service', () => {
  beforeEach(() => {
    resetDeveloperOtps();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetDeveloperOtps();
  });

  it('issues a 6-digit code that expires in the future', () => {
    const { code, expiresAt } = issueDeveloperOtp({ userId: 1, purpose: 'test' });
    expect(code).toMatch(/^\d{6}$/);
    expect(expiresAt).toBeGreaterThan(Date.now());
  });

  it('verifies without consuming when consume is false', () => {
    const { code } = issueDeveloperOtp({ userId: 2, purpose: 'test' });
    const firstCheck = verifyDeveloperOtp({ userId: 2, purpose: 'test', code, consume: false });
    expect(firstCheck.ok).toBe(true);
    const secondCheck = verifyDeveloperOtp({ userId: 2, purpose: 'test', code, consume: true });
    expect(secondCheck.ok).toBe(true);
  });

  it('consumes the code when requested', () => {
    const { code } = issueDeveloperOtp({ userId: 3, purpose: 'cleanup' });
    const result = verifyDeveloperOtp({ userId: 3, purpose: 'cleanup', code, consume: true });
    expect(result.ok).toBe(true);
    const reuseAttempt = verifyDeveloperOtp({ userId: 3, purpose: 'cleanup', code, consume: true });
    expect(reuseAttempt.ok).toBe(false);
    expect(reuseAttempt.reason).toBe('not-found');
  });

  it('fails verification after expiry', () => {
    const { code } = issueDeveloperOtp({ userId: 4, purpose: 'expire' });
    vi.advanceTimersByTime(OTP_TTL_MS + 1000);
    const outcome = verifyDeveloperOtp({ userId: 4, purpose: 'expire', code, consume: true });
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('expired');
  });
});
