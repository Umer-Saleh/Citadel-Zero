/**
 * Thin wrapper over fetch. Attaches the bearer token, parses JSON,
 * turns non-2xx responses into thrown errors carrying the server's
 * machine-readable code, and transparently refreshes an expired
 * access token.
 */

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// Both tokens live in memory only, like the DEK. localStorage would
// survive a refresh — which is exactly what we don't want, since it
// would also survive an attacker reading it from another script.
let accessToken = null;
let refreshToken = null;

// The single in-flight refresh, or null. See refreshOnce below.
let refreshInFlight = null;

// Called when a refresh fails: the session is gone and the app has to
// drop to the unlock screen. VaultContext registers lock() here.
let onSessionLost = () => {};

export function setToken(token) {
  accessToken = token;
}

export function setRefreshToken(token) {
  refreshToken = token;
}

export function clearToken() {
  accessToken = null;
  refreshToken = null;
  refreshInFlight = null;
}

export function setSessionLostHandler(fn) {
  onSessionLost = fn;
}

/** The refresh token, so VaultContext can hand it to logout(). */
export function getRefreshToken() {
  return refreshToken;
}

class ApiError extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

/**
 * Refresh the access token, at most once concurrently.
 *
 * This matters more than it looks. The app fires several vault
 * requests at once, so when the access token expires they all 401
 * together. If each retried independently, each would POST the same
 * refresh token — and the server's reuse detection would correctly
 * read that as theft and revoke the entire family, logging the user
 * out for the crime of loading their own vault.
 *
 * So the first caller starts the refresh and stores the promise;
 * everyone else awaits that same promise. One rotation, one new
 * token, no false positive.
 */
function refreshOnce() {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    if (!refreshToken) throw new ApiError('NO_REFRESH_TOKEN', 401);

    const res = await fetch(BASE + '/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken })
    });

    if (!res.ok) throw new ApiError('SESSION_EXPIRED', 401);

    const data = await res.json();
    accessToken = data.token;
    refreshToken = data.refreshToken;   // rotated — the old one is dead
    return data.token;
  })();

  // Clear the slot however it settles, so the NEXT expiry starts a
  // fresh refresh rather than replaying this promise forever.
  refreshInFlight.finally(() => { refreshInFlight = null; });

  return refreshInFlight;
}

async function send(method, path, body) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
  } catch {
    // Network failure, server down, CORS — no HTTP response at all.
    throw new ApiError('NETWORK_ERROR', 0);
  }

  let data = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch { /* non-JSON body */ }
  }

  return { res, data };
}

async function request(method, path, body) {
  let { res, data } = await send(method, path, body);

  // A 401 on an authenticated request means the access token expired.
  // Refresh and retry once — the user should never see this happen.
  //
  // `retried` guards against a loop: if the retry also 401s, the
  // problem isn't a stale token and refreshing again won't help.
  if (res.status === 401 && refreshToken && !path.startsWith('/api/auth/')) {
    try {
      await refreshOnce();
    } catch {
      // The refresh token is dead too — expired, revoked, or the
      // family was killed by reuse detection. Nothing left to try.
      clearToken();
      onSessionLost();
      throw new ApiError('SESSION_EXPIRED', 401);
    }

    ({ res, data } = await send(method, path, body));
  }

  if (!res.ok) {
    throw new ApiError(data?.error || 'REQUEST_FAILED', res.status);
  }

  return data;
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  put: (path, body) => request('PUT', path, body),
  delete: (path) => request('DELETE', path),
  ApiError
};