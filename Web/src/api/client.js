/**
 * Thin wrapper over fetch. Attaches the bearer token, parses JSON,
 * and turns non-2xx responses into thrown errors carrying the
 * server's machine-readable code (EMAIL_TAKEN, INVALID_CREDENTIALS, ...).
 */

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

let accessToken = null;

export function setToken(token) {
  accessToken = token;
}

export function clearToken() {
  accessToken = null;
}

class ApiError extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

async function request(method, path, body) {
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