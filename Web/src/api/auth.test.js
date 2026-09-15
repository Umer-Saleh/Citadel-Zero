import { describe, test, expect, vi, beforeEach } from 'vitest';

// The network is the adversary in these tests, so it is the thing mocked.
vi.mock('./client', () => ({
  api: { get: vi.fn(), post: vi.fn() },
  setToken: vi.fn(),
  setRefreshToken: vi.fn(),
  getRefreshToken: vi.fn(),
  clearToken: vi.fn()
}));

import { api } from './client';
import { login, changePassword, upgradeKdf, regenerateRecoveryKit } from './auth';

const WEAK = { kdfSalt: 'AAAAAAAAAAAAAAAAAAAAAA==', kdfParams: { m: 8, t: 1, p: 1 }, totpEnabled: false };

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  api.get.mockResolvedValue(WEAK);
});

// A malicious server answering kdf-params with trivially cheap settings
// must not receive an auth hash derived under them. Each flow that
// derives from server-supplied parameters refuses BEFORE any POST.
describe('a server proposing weak KDF parameters gets nothing', () => {
  test('login', async () => {
    await expect(login('a@example.com', 'password')).rejects.toMatchObject({ code: 'UNSAFE_KDF_PARAMS' });
    expect(api.post).not.toHaveBeenCalled();
  });

  test('password change', async () => {
    await expect(changePassword('a@example.com', 'old', 'new', new Uint8Array(32)))
      .rejects.toMatchObject({ code: 'UNSAFE_KDF_PARAMS' });
    expect(api.post).not.toHaveBeenCalled();
  });

  test('KDF upgrade', async () => {
    await expect(upgradeKdf('a@example.com', 'password', new Uint8Array(32)))
      .rejects.toMatchObject({ code: 'UNSAFE_KDF_PARAMS' });
    expect(api.post).not.toHaveBeenCalled();
  });

  test('recovery kit regeneration', async () => {
    await expect(regenerateRecoveryKit('a@example.com', 'password', new Uint8Array(32)))
      .rejects.toMatchObject({ code: 'UNSAFE_KDF_PARAMS' });
    expect(api.post).not.toHaveBeenCalled();
  });
});
