import { describe, test, expect, beforeEach, vi } from 'vitest';
import {
  provisionDemoVault, resumeDemoVault,
  saveDemoCredentials, loadDemoCredentials, clearDemoCredentials
} from './provisionDemo';
import { DEMO_FIXTURES } from './demoFixtures';

// Node has no sessionStorage. The module is written to survive that,
// which this stub lets us verify both ways.
function installStorage() {
  const map = new Map();
  globalThis.sessionStorage = {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: k => map.delete(k),
    clear: () => map.clear()
  };
}

beforeEach(() => installStorage());

test('storage being entirely unavailable degrades instead of throwing', async () => {
  delete globalThis.sessionStorage;

  expect(() => saveDemoCredentials({ email: 'a@demo.invalid', password: 'p' })).not.toThrow();
  expect(loadDemoCredentials()).toBeNull();
  expect(() => clearDemoCredentials()).not.toThrow();

  // Provisioning still succeeds — it just cannot be resumed later.
  const creds = await provisionDemoVault({ signup: async()=>{}, login: async()=>{}, addItem: async()=>{} });
  expect(creds.email).toMatch(/@demo\.invalid$/);

  installStorage();
});

describe('provisioning', () => {
  test('runs signup, login, then every fixture in order', async () => {
    const calls = [];
    const signup = vi.fn(async () => { calls.push('signup'); return { recoveryKey: 'K' }; });
    const login = vi.fn(async () => { calls.push('login'); });
    const addItem = vi.fn(async (d) => { calls.push('item:' + d.site); });

    const creds = await provisionDemoVault({ signup, login, addItem });

    expect(calls[0]).toBe('signup');
    expect(calls[1]).toBe('login');
    expect(calls.slice(2)).toEqual(DEMO_FIXTURES.map(f => 'item:' + f.site));
    expect(addItem).toHaveBeenCalledTimes(5);
    // signup and login must receive the SAME credentials
    expect(signup.mock.calls[0]).toEqual(login.mock.calls[0]);
    expect(creds.email).toMatch(/^demo-[0-9a-f]{20}@demo\.invalid$/);
    expect(creds.password).toHaveLength(32);
  });

  test('identities are unique and unbiased in shape', async () => {
    const seen = new Set();
    for (let i = 0; i < 40; i++) {
      const c = await provisionDemoVault({ signup: async()=>{}, login: async()=>{}, addItem: async()=>{} });
      expect(c.email).toMatch(/^demo-[0-9a-f]{20}@demo\.invalid$/);
      expect(c.password).toMatch(/^[ABCDEFGHJKMNPQRSTVWXYZ23456789+-]{32}$/);
      seen.add(c.email);
    }
    expect(seen.size).toBe(40);
  });

  test('credentials are NOT stored when provisioning fails', async () => {
    const signup = async () => { throw new Error('boom'); };
    await expect(provisionDemoVault({ signup, login: async()=>{}, addItem: async()=>{} })).rejects.toThrow();
    expect(loadDemoCredentials()).toBeNull();
  });

  test('credentials are NOT stored when an item write fails', async () => {
    let n = 0;
    const addItem = async () => { if (++n === 3) throw new Error('nope'); };
    await expect(provisionDemoVault({ signup: async()=>{}, login: async()=>{}, addItem })).rejects.toThrow();
    expect(loadDemoCredentials()).toBeNull();
  });
});

describe('resume', () => {
  test('returns false with no stored credentials, and does NOT provision', async () => {
    const login = vi.fn();
    expect(await resumeDemoVault({ login })).toBe(false);
    expect(login).not.toHaveBeenCalled();
  });

  test('logs in with the stored credentials', async () => {
    saveDemoCredentials({ email: 'demo-x@demo.invalid', password: 'pw' });
    const login = vi.fn(async () => {});
    expect(await resumeDemoVault({ login })).toBe(true);
    expect(login).toHaveBeenCalledWith('demo-x@demo.invalid', 'pw');
  });

  test('a wiped account clears the stale credentials and reports false', async () => {
    saveDemoCredentials({ email: 'demo-y@demo.invalid', password: 'pw' });
    const login = async () => { const e = new Error('gone'); e.code = 'NOT_FOUND'; throw e; };
    expect(await resumeDemoVault({ login })).toBe(false);
    expect(loadDemoCredentials()).toBeNull();
  });

  test('an unexpected failure propagates rather than silently clearing', async () => {
    saveDemoCredentials({ email: 'demo-z@demo.invalid', password: 'pw' });
    const login = async () => { const e = new Error('offline'); e.code = 'NETWORK_ERROR'; throw e; };
    await expect(resumeDemoVault({ login })).rejects.toThrow('offline');
    expect(loadDemoCredentials()).not.toBeNull();
  });

  test('malformed stored JSON is treated as absent', async () => {
    sessionStorage.setItem('cz.demo.vault', '{not json');
    expect(loadDemoCredentials()).toBeNull();
    const login = vi.fn();
    expect(await resumeDemoVault({ login })).toBe(false);
    expect(login).not.toHaveBeenCalled();
  });
});
