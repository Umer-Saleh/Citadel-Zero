import { describe, test, expect } from 'vitest';
import { codeToMessage } from './errors';

/**
 * One map, so a code has copy in one place instead of ten.
 *
 * Before this, every handler carried its own ternary chain and they
 * disagreed with each other. The survey found eight codes with no
 * human copy anywhere in the client — a visitor who hit one read a
 * bare identifier in red — and four more that had copy on some screens
 * and appeared raw on others.
 */

const err = (code) => Object.assign(new Error(code), { code });

/** A message is "human" if it is not just the identifier echoed back. */
const isHuman = (m, code) =>
  typeof m === 'string' && m.length > code.length && /[a-z]/.test(m) && m !== code;

describe('codes that had no copy anywhere', () => {
  // Exactly the list from the survey. Each of these used to reach a
  // visitor as a bare identifier or not at all.
  test.each([
    'TOO_MANY_REQUESTS',
    'INTERNAL_ERROR',
    'REQUEST_FAILED',
    'NO_TOKEN',
    'INVALID_TOKEN',
    'TOTP_NOT_ENABLED',
    'SESSION_EXPIRED',
    'NO_REFRESH_TOKEN'
  ])('%s now reads as a sentence', (code) => {
    const message = codeToMessage(err(code), 'Something failed');

    expect(isHuman(message, code)).toBe(true);
    // Mapped codes carry copy INSTEAD of the identifier — the raw code
    // is for the fallback, where there is nothing better to say.
    expect(message).not.toContain(code);
    expect(message).not.toContain('Something failed');
  });
});

describe('the request-level codes express.json raises', () => {
  // All three used to arrive as INTERNAL_ERROR, so the server looked
  // broken when it had refused something specific.
  test.each([
    'PAYLOAD_TOO_LARGE',
    'MALFORMED_JSON',
    'UNSUPPORTED_ENCODING'
  ])('%s reads as a sentence', (code) => {
    const message = codeToMessage(err(code), 'Could not save this entry');

    expect(isHuman(message, code)).toBe(true);
    expect(message).not.toContain(code);
    expect(message).not.toContain('Could not save this entry');
  });

  test('PAYLOAD_TOO_LARGE says what the limit is and what to do', () => {
    // The only one of the three an ordinary person can reach: a long
    // enough notes field on a vault entry cannot be sent.
    //
    // 32, not 64. The body cap is 64 KB, but an entry is padded into a
    // fixed bucket first and the buckets step 16384 -> 32768 -> 65536;
    // base64 makes the 32768 bucket 43,692 characters, which fits, and
    // the next one 87,384, which does not. So 32 KB is the boundary
    // that actually bites, and the message used to quote a number the
    // reader was comfortably under while being refused. Measured:
    // 32,000 characters of notes saves, 33,000 does not.
    const message = codeToMessage(err('PAYLOAD_TOO_LARGE'), 'Could not save this entry');

    expect(message).toContain('32 KB');
    expect(message).toContain('notes');

    // The old number was not merely imprecise, it was unreachable
    // advice — so quoting it again is the regression to catch.
    expect(message).not.toContain('64 KB');
  });

  test('the two that only a client bug can cause say so', () => {
    // Neither is reachable by using the app correctly, so the honest
    // thing is to say it is not the reader's fault.
    for (const code of ['MALFORMED_JSON', 'UNSUPPORTED_ENCODING']) {
      expect(codeToMessage(err(code), 'x')).toContain('not something you did');
    }
  });
});

describe('VAULT_FULL', () => {
  test('reads as a sentence and says what the limit is', () => {
    const message = codeToMessage(err('VAULT_FULL'), 'Could not save this entry');

    expect(isHuman(message, 'VAULT_FULL')).toBe(true);
    expect(message).not.toContain('VAULT_FULL');
    // The number has to appear, or the person cannot tell whether they
    // are near the limit or far past it.
    expect(message).toContain('1,000');
    // And it has to say what to do about it.
    expect(message).toContain('Delete');
  });
});

describe('codes that were inconsistent across screens', () => {
  test.each([
    'TOO_MANY_ATTEMPTS',
    'VALIDATION_FAILED',
    'NETWORK_ERROR'
  ])('%s reads the same wherever it is raised', (code) => {
    // Same input, two unrelated callers, one sentence.
    const onUnlock = codeToMessage(err(code), 'Could not unlock');
    const inSettings = codeToMessage(err(code), 'Upgrade failed');

    expect(onUnlock).toBe(inSettings);
    expect(isHuman(onUnlock, code)).toBe(true);
  });

  test('NOT_FOUND stays per-screen, because it means different things', () => {
    // Deliberately absent from the shared map: on the unlock screen it
    // means no vault for that email; on a vault write it means the
    // entry is gone. One sentence for both would be worse than what it
    // replaced.
    const unlock = codeToMessage(err('NOT_FOUND'), 'Could not unlock', {
      NOT_FOUND: 'No vault found for that email.'
    });
    expect(unlock).toBe('No vault found for that email.');

    // With no override it falls through and names the code rather than
    // inventing a meaning it cannot know.
    expect(codeToMessage(err('NOT_FOUND'), 'Could not load'))
      .toBe('Could not load (NOT_FOUND).');
  });
});

describe('overrides', () => {
  test('a screen can say it better than the shared map', () => {
    expect(codeToMessage(err('VALIDATION_FAILED'), 'Upgrade failed', {
      VALIDATION_FAILED: 'The upgrade request was malformed. This is a bug, not something you did.'
    })).toBe('The upgrade request was malformed. This is a bug, not something you did.');
  });

  test('an override for an unrelated code does not shadow the shared one', () => {
    expect(codeToMessage(err('NETWORK_ERROR'), 'x', { EMAIL_TAKEN: 'nope' }))
      .toBe('Cannot reach the server.');
  });

  test('an override set to empty string wins, rather than falling through', () => {
    // hasOwnProperty, not truthiness: a caller that deliberately
    // silences a code must not get the shared sentence instead.
    expect(codeToMessage(err('NETWORK_ERROR'), 'x', { NETWORK_ERROR: '' })).toBe('');
  });
});

describe('the fallback keeps the code visible', () => {
  test('an unmapped code is named, not swallowed', () => {
    expect(codeToMessage(err('SOME_NEW_CODE'), 'Could not unlock'))
      .toBe('Could not unlock (SOME_NEW_CODE).');
  });

  test('an exception with no code falls back to its message', () => {
    // A DOMException out of crypto.subtle has no .code at all. Reporting
    // only the code rendered a bare sentence and left nothing to go on.
    expect(codeToMessage(new TypeError('key is not of type BufferSource'), 'Could not create a demo vault'))
      .toBe('Could not create a demo vault: key is not of type BufferSource');
  });

  test('a thrown value with neither is still a sentence', () => {
    expect(codeToMessage({}, 'Could not unlock')).toBe('Could not unlock.');
    expect(codeToMessage(null, 'Could not unlock')).toBe('Could not unlock.');
    expect(codeToMessage(undefined, 'Could not unlock')).toBe('Could not unlock.');
  });
});
