import { describe, test, expect, vi, beforeEach } from 'vitest';

/**
 * What the client does with the body of a response.
 *
 * The interesting case is a 2xx the app cannot read. It used to return
 * null, quietly, and every caller destructures what request() returns —
 * so a gateway or CDN answering 200 with its own HTML produced either a
 * raw TypeError carrying no code and no status, or an object with every
 * field undefined that the caller treated as a successful write. Both
 * were indistinguishable from success at the call site.
 *
 * The distinction that makes this safe is between a body that was
 * ABSENT and one that was UNREADABLE. Logout answers 204 with nothing
 * at all and must keep returning null, so the check is on the parse
 * failing, never on the value being null.
 */

// request() touches only these three members of a Response.
const reply = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => body
});

const { api, clearToken } = await import('./client');

beforeEach(() => {
  vi.restoreAllMocks();
  // Module-level token state survives between tests in a file. Cleared
  // so the 401 refresh branch stays out of these cases entirely.
  clearToken();
});

/** The one that used to return null. */
describe('a 2xx whose body cannot be parsed', () => {
  test('is refused, and carries the status it arrived with', async () => {
    globalThis.fetch = vi.fn(async () => reply(200, '<html>gateway</html>'));

    await expect(api.get('/api/vault')).rejects.toMatchObject({
      code: 'REQUEST_FAILED',
      status: 200
    });
  });

  test('is refused on any 2xx, not only 200', async () => {
    globalThis.fetch = vi.fn(async () => reply(201, 'not json at all'));

    await expect(api.post('/api/vault', { x: 1 })).rejects.toMatchObject({
      code: 'REQUEST_FAILED',
      status: 201
    });
  });
});

describe('bodies that are readable, or legitimately absent', () => {
  /**
   * Deliberately NOT this commit's business.
   *
   * An object with no `id` is valid JSON and is passed straight
   * through. Whether a save may accept it is a question about the save
   * path, answered where that decision is made — not here, by guessing
   * which fields a caller wanted.
   */
  test('an empty object is returned unchanged, not refused', async () => {
    globalThis.fetch = vi.fn(async () => reply(200, '{}'));

    await expect(api.post('/api/vault', { x: 1 })).resolves.toEqual({});
  });

  test('a 204 with no body still returns null', async () => {
    globalThis.fetch = vi.fn(async () => reply(204, ''));

    await expect(api.post('/api/auth/logout', { t: 'x' })).resolves.toBeNull();
  });

  test('ordinary JSON is parsed and returned', async () => {
    globalThis.fetch = vi.fn(async () => reply(201, '{"id":"abc-123"}'));

    await expect(api.post('/api/vault', { x: 1 })).resolves.toEqual({ id: 'abc-123' });
  });
});

/**
 * The error path already handled unreadable bodies correctly, by
 * falling back to REQUEST_FAILED when there was no `error` field to
 * read. These pin that it still does: the new check sits after the
 * status check precisely so this branch keeps its own status and copy.
 */
describe('a non-2xx is unaffected', () => {
  test('an unreadable error body still reports the server status', async () => {
    globalThis.fetch = vi.fn(async () => reply(502, '<html>bad gateway</html>'));

    await expect(api.get('/api/vault')).rejects.toMatchObject({
      code: 'REQUEST_FAILED',
      status: 502
    });
  });

  test("a readable error body still reports the server's own code", async () => {
    globalThis.fetch = vi.fn(async () => reply(409, '{"error":"VAULT_FULL"}'));

    await expect(api.post('/api/vault', { x: 1 })).rejects.toMatchObject({
      code: 'VAULT_FULL',
      status: 409
    });
  });
});
