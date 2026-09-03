import { DEMO_FIXTURES } from './demoFixtures';

/**
 * Per-visitor demo vaults.
 *
 * Every visitor who asks for a demo gets their own throwaway account,
 * created here in the browser through the ordinary signup path. There
 * is no shared demo account and no special server endpoint.
 *
 * WHY THERE IS NO SERVER-SIDE PROVISIONING
 * ----------------------------------------
 * The vault is zero-knowledge. Items are sealed under a DEK derived
 * from a password the server never receives, so a server-side
 * "create demo vault" endpoint could only ever produce an empty
 * account or one it could read — and the second would break the whole
 * claim of the project. Provisioning therefore runs entirely
 * client-side and uses the same signup, login and vault routes a real
 * account uses. No route knows this is a demo.
 *
 * WHAT REPLACING THE SHARED ACCOUNT FIXES
 * ---------------------------------------
 * One shared account with published credentials meant any visitor was
 * authenticated AS that account: they could change its password,
 * enable TOTP and lock everyone out permanently, rotate its recovery
 * kit, or edit the seeded items for everyone arriving in the next
 * 24 hours. A guard blocking those routes would work, but it would
 * need remembering for every account route added afterwards. No shared
 * identity means there is nothing to brick and no list to keep right.
 *
 * COST — READ BEFORE CALLING THIS FROM ANYWHERE NEW
 * -------------------------------------------------
 * One provision costs one 128 MiB Argon2id derivation in the browser
 * and THREE 64 MiB Argon2 operations on the server: signup hardens
 * both the auth hash and the recovery verifier, then login verifies.
 * The API container has a 640 MB limit.
 *
 * So this must only ever run from a deliberate user action. It must
 * never be called from an effect, a route match, a retry, or anything
 * else that a crawler or a security scanner could trigger by fetching
 * a page. That is not a style preference: a scanner hitting the
 * homepage in a loop would exhaust the container's memory.
 */

// Hex, and a 32-character alphabet, both powers of two. Slicing random
// bytes into 4- and 5-bit fields is uniform by construction, so there
// is no modulo bias to reject — unlike an arbitrary-length pool.
const HEX = '0123456789abcdef';
const PW_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789+-';   // 32 chars

/** Random hex, 4 bits per character, no bias. */
function randomHex(chars) {
  const bytes = crypto.getRandomValues(new Uint8Array(Math.ceil(chars / 2)));
  let out = '';
  for (const b of bytes) out += HEX[b >> 4] + HEX[b & 0x0f];
  return out.slice(0, chars);
}

/** Random password, 5 bits per character, no bias. */
function randomPassword(chars = 32) {
  const bytes = crypto.getRandomValues(new Uint8Array(chars));
  let out = '';
  // One byte per character, keeping the low 5 bits. Wasteful of
  // entropy and completely uniform, which is the trade worth making.
  for (const b of bytes) out += PW_ALPHABET[b & 0x1f];
  return out;
}

/**
 * A throwaway identity.
 *
 * `.invalid` is reserved by RFC 2606 and can never resolve, so these
 * addresses cannot collide with a real mailbox or be used to mail
 * anyone. Verified against the server's signup schema, which accepts
 * them.
 *
 * 80 bits in the local part makes collision between two visitors
 * provisioning at the same moment not worth reasoning about; a
 * collision would surface as EMAIL_TAKEN and nothing worse.
 */
function newIdentity() {
  return {
    email: `demo-${randomHex(20)}@demo.invalid`,
    password: randomPassword(32)     // 160 bits, never shown to anyone
  };
}

// ---------------------------------------------------------------
// SESSION STORAGE
//
// sessionStorage, not localStorage: a demo vault lives until the tab
// closes and is deleted from the server nightly regardless. Persisting
// it beyond the tab would outlive the account it points at.
//
// Every access is guarded. sessionStorage throws rather than returning
// null in a locked-down browser, and a demo that cannot remember a
// credential should still work, not crash on load.
// ---------------------------------------------------------------
const STORAGE_KEY = 'cz.demo.vault';

export function saveDemoCredentials(credentials) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(credentials));
  } catch {
    // Storage unavailable. The vault the visitor just provisioned
    // still works for this page; they simply cannot resume it after a
    // refresh, which is a smaller loss than failing the provision.
  }
}

export function loadDemoCredentials() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.email !== 'string' || typeof parsed.password !== 'string') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearDemoCredentials() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch { /* nothing to clear if storage is unavailable */ }
}

// ---------------------------------------------------------------
// PROVISIONING
// ---------------------------------------------------------------

/**
 * Create a demo vault and unlock it.
 *
 * Takes its collaborators as arguments rather than importing the vault
 * context, so the orchestration can be reasoned about — and tested —
 * without React, and so the DEK stays where it already lives.
 *
 * @param signup   (email, password) => Promise, the real signup flow.
 *                 Derives Argon2id in the browser, generates the DEK
 *                 and both wrappers, and sends the recoveryAuthHash
 *                 the server has required since proof of possession
 *                 landed.
 * @param login    (email, password) => Promise, puts the DEK in memory.
 * @param addItem  (data) => Promise, encrypts one item and stores it.
 *
 * @returns { email, password } — also written to sessionStorage, so a
 *          refresh can offer to resume rather than stranding the tab.
 */
export async function provisionDemoVault({ signup, login, addItem }) {
  const { email, password } = newIdentity();

  // The ordinary signup path. Its return value is the one-time
  // recovery key; a throwaway vault has nobody to show it to, so it is
  // deliberately dropped here rather than stored.
  await signup(email, password);

  await login(email, password);

  // Sequentially, not Promise.all. Five parallel writes would race the
  // token refresh if the access token expired mid-flight, and the
  // ordering is what puts the fixtures in a predictable order in the
  // list.
  for (const item of DEMO_FIXTURES) {
    await addItem(item);
  }

  // Written last. If anything above threw, there are no credentials
  // stored for a vault that may not exist or may be half-built.
  saveDemoCredentials({ email, password });

  return { email, password };
}

/**
 * Log back into a demo vault provisioned earlier in this tab.
 *
 * Separate from provisioning on purpose: resuming must never fall back
 * to creating. If the account is gone — the nightly wipe is the
 * ordinary reason — this clears the stale credentials and reports it,
 * and the caller offers to provision a new vault. It does not do so
 * itself, because that would put account creation behind a code path
 * the visitor did not aim at.
 *
 * @returns true if the vault was reopened, false if it no longer
 *          exists. Any other failure throws and is the caller's to
 *          report.
 */
export async function resumeDemoVault({ login }) {
  const credentials = loadDemoCredentials();
  if (!credentials) return false;

  try {
    await login(credentials.email, credentials.password);
    return true;
  } catch (err) {
    // NOT_FOUND: the account was wiped. INVALID_CREDENTIALS: it was
    // wiped and the address reused, or the password was rotated. Both
    // mean the stored credentials are dead.
    if (err.code === 'NOT_FOUND' || err.code === 'INVALID_CREDENTIALS') {
      clearDemoCredentials();
      return false;
    }
    throw err;
  }
}
