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

/**
 * WHICH 401s ARE WORTH A REFRESH.
 *
 * The cases above deliberately clear the tokens so the 401 branch
 * never runs, so until now the refresh-and-retry had no coverage at
 * all. These cover it, and the distinction it now makes.
 *
 * The server answers 401 for two unrelated things. A token that is no
 * good (INVALID_TOKEN, NO_TOKEN — from requireAuth) is worth a refresh
 * and a retry, silently. A credential the user typed wrong
 * (INVALID_CREDENTIALS, INVALID_TOTP_CODE — from the services) is
 * worth neither: refreshing cannot make a wrong password right.
 *
 * Treating the second as the first cost four auth requests per wrong
 * attempt against a production bucket of six, so two typos locked a
 * real user out. The pinned server half is
 * Server/test/e2e/auth-401-codes.test.js.
 */

// Imported separately rather than by widening the destructure above,
// so nothing already in this file changes.
const { setToken, setRefreshToken } = await import('./client');

/** A reply readable by both send() (text) and refreshOnce() (json). */
const jsonReply = (status, obj) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(obj),
  json: async () => obj
});

/**
 * Queue the replies this test expects, in order, and record the calls.
 *
 * A fetch beyond the queue throws rather than returning undefined: the
 * whole point of these tests is HOW MANY requests leave the client, so
 * an unexpected extra one has to fail loudly rather than as a
 * confusing TypeError.
 */
function mockFetch(...replies) {
  const calls = [];

  globalThis.fetch = vi.fn(async (url, init) => {
    calls.push({
      url,
      method: init?.method,
      auth: init?.headers?.Authorization
    });

    if (!replies.length) throw new Error(`unexpected extra request: ${url}`);
    return replies.shift();
  });

  return calls;
}

/** A live session: an access token and a refresh token in memory. */
function signedIn() {
  setToken('access-1');
  setRefreshToken('refresh-1');
}

const refreshed = () => jsonReply(200, { token: 'access-2', refreshToken: 'refresh-2' });

describe('a 401 that means the access token is no good', () => {
  test('INVALID_TOKEN spends one refresh and one retry', async () => {
    signedIn();
    const calls = mockFetch(
      jsonReply(401, { error: 'INVALID_TOKEN' }),
      refreshed(),
      jsonReply(200, { items: [] })
    );

    await expect(api.get('/api/vault')).resolves.toEqual({ items: [] });

    expect(calls).toHaveLength(3);
    expect(calls[1].url).toContain('/api/auth/refresh');
    // The retry carries the token the refresh just issued. Without
    // this the test would pass on a retry that replayed the dead one.
    expect(calls[2].auth).toBe('Bearer access-2');
  });

  test('NO_TOKEN spends one refresh and one retry', async () => {
    signedIn();
    const calls = mockFetch(
      jsonReply(401, { error: 'NO_TOKEN' }),
      refreshed(),
      jsonReply(200, { items: [] })
    );

    await expect(api.get('/api/vault')).resolves.toEqual({ items: [] });

    expect(calls).toHaveLength(3);
    expect(calls[1].url).toContain('/api/auth/refresh');
  });

  test('a retry that 401s again does not refresh a second time', async () => {
    signedIn();
    const calls = mockFetch(
      jsonReply(401, { error: 'INVALID_TOKEN' }),
      refreshed(),
      jsonReply(401, { error: 'INVALID_TOKEN' })
    );

    // The second 401 is returned as it arrived. A fresh token did not
    // help, so the problem is not a stale token.
    await expect(api.get('/api/vault')).rejects.toMatchObject({
      code: 'INVALID_TOKEN',
      status: 401
    });

    expect(calls).toHaveLength(3);
    expect(calls.filter(c => c.url.includes('/api/auth/refresh'))).toHaveLength(1);
  });
});

describe('a 401 that means a credential was wrong', () => {
  test('INVALID_CREDENTIALS is surfaced without a refresh or a retry', async () => {
    signedIn();
    const calls = mockFetch(jsonReply(401, { error: 'INVALID_CREDENTIALS' }));

    await expect(
      api.post('/api/account/password', { currentAuthHash: 'wrong' })
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', status: 401 });

    // One request, and it is the one the caller asked for. This is the
    // whole fix: the three that used to follow are what emptied the
    // auth bucket.
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/api/account/password');
  });

  test('INVALID_TOTP_CODE is surfaced without a refresh or a retry', async () => {
    signedIn();
    const calls = mockFetch(jsonReply(401, { error: 'INVALID_TOTP_CODE' }));

    await expect(
      api.post('/api/account/totp/confirm', { code: '000000' })
    ).rejects.toMatchObject({ code: 'INVALID_TOTP_CODE', status: 401 });

    expect(calls).toHaveLength(1);
  });

  test('a 401 whose body cannot be read is surfaced, not retried', async () => {
    signedIn();
    const calls = mockFetch({
      ok: false,
      status: 401,
      text: async () => '<html>gateway</html>'
    });

    // The allowlist costs this case: an unreadable body is not a token
    // code, so it is reported rather than retried. Nothing in front of
    // this API produces one today.
    await expect(api.get('/api/vault')).rejects.toMatchObject({
      code: 'REQUEST_FAILED',
      status: 401
    });

    expect(calls).toHaveLength(1);
  });
});
