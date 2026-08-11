import { api } from './client';

/**
 * Two-factor enrolment and removal.
 *
 * Deliberately NOT part of the key hierarchy. The TOTP secret is
 * symmetric — the server holds the same value your phone does — so
 * deriving anything from it would put a server-known value under the
 * vault. 2FA guards the API; the master password guards the vault.
 */

/** Generate a secret and return the otpauth URI to scan. Does not enable. */
export function beginEnrolment() {
  return api.post('/api/account/totp/begin');
}

/** Verify a code, enable 2FA, and receive the backup codes ONCE. */
export function confirmEnrolment(code) {
  return api.post('/api/account/totp/confirm', { code });
}

/** Turn 2FA off. Requires a current code or a backup code. */
export function disable(code) {
  return api.post('/api/account/totp/disable', { code });
}

/** Whether 2FA is currently on for this account. */
export async function isEnabled(email) {
  const { totpEnabled } = await api.get(
    `/api/user/kdf-params?email=${encodeURIComponent(email)}`
  );
  return totpEnabled;
}