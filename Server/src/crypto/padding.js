/**
 * Pad plaintext into fixed-size buckets before encryption.
 *
 * GCM ciphertext is the same length as its plaintext, so without this
 * an observer holding the database learns roughly how long each
 * password is — and short is a useful thing for an attacker to know.
 *
 * Format: a 4-byte big-endian length prefix, then the plaintext, then
 * zero bytes to the next bucket boundary. The prefix is what makes the
 * padding removable; trailing zeros alone would be ambiguous with a
 * plaintext that genuinely ends in zeros.
 *
 * The prefix is INSIDE the encryption, so it leaks nothing.
 */

const PREFIX_BYTES = 4;

// Powers of two from 256 bytes. Most vault items land in the first
// bucket, so most items are indistinguishable from each other.
const BUCKETS = [256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536];

function bucketFor(size) {
  const found = BUCKETS.find(b => size <= b);
  // Beyond the largest bucket, round up to a multiple of it rather
  // than throwing. A 200KB note is unusual but shouldn't fail.
  if (found) return found;
  const largest = BUCKETS[BUCKETS.length - 1];
  return Math.ceil(size / largest) * largest;
}

/** @param plaintext Buffer or Uint8Array @returns Uint8Array */
function pad(plaintext) {
  const total = bucketFor(plaintext.length + PREFIX_BYTES);
  const out = new Uint8Array(total);           // zero-filled

  // Big-endian length prefix.
  out[0] = (plaintext.length >>> 24) & 0xff;
  out[1] = (plaintext.length >>> 16) & 0xff;
  out[2] = (plaintext.length >>> 8) & 0xff;
  out[3] = plaintext.length & 0xff;

  out.set(plaintext, PREFIX_BYTES);
  return out;
}

/** @param padded Uint8Array @returns Uint8Array */
function unpad(padded) {
  if (padded.length < PREFIX_BYTES) {
    throw new Error('padded payload too short');
  }

  const length =
    (padded[0] << 24) | (padded[1] << 16) | (padded[2] << 8) | padded[3];

  // A corrupt or malicious length would otherwise slice out of range.
  // GCM already authenticated this, so reaching here means a bug —
  // fail loudly rather than returning garbage.
  if (length < 0 || length + PREFIX_BYTES > padded.length) {
    throw new Error('invalid padded length prefix');
  }

  return padded.slice(PREFIX_BYTES, PREFIX_BYTES + length);
}

module.exports = { pad, unpad, BUCKETS, PREFIX_BYTES };