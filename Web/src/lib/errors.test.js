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

  test('PAYLOAD_TOO_LARGE says what to do without naming a figure', () => {
    // THREE dead figures now, and all three guards are below.
    //
    //   64 KB was the body limit quoted as an entry limit.
    //   32 KB was the entry limit before the transport was raised.
    //   65,000 characters was the entry limit in ASCII and in nothing
    //   else — the cap is 65,532 BYTES through TextEncoder, and a
    //   newline or an Arabic letter costs two of them, a CJK
    //   character three, an emoji four. It promised an Arabic speaker
    //   double the room and an emoji user quadruple.
    //
    // The '65,000' guard was a toContain until this change. It is
    // inverted rather than deleted: the figure is gone from the copy
    // because no single number is honest across scripts, so the thing
    // worth pinning is that it does not come back. Same shape as the
    // two guards it joins.
    const message = codeToMessage(err('PAYLOAD_TOO_LARGE'), 'Could not save this entry');

    // GUARDS FIRST, and that ordering is deliberate. These are the
    // regression the test exists for; a positive assertion failing
    // above them would short-circuit the case and hide whether the
    // guard still bites.
    expect(message).not.toContain('64 KB');
    expect(message).not.toContain('32 KB');
    expect(message).not.toContain('65,000');

    // Still actionable, and still says the budget is shared.
    expect(message).toContain('notes');
    expect(message).toContain('every field shares one budget');
  });

  test('PAYLOAD_TOO_LARGE does not send the reader to a meter that is not there', () => {
    // Deliberately different from ITEM_TOO_LARGE. Padding is bucketed,
    // so if the client and server limits ever drift apart, ANY entry
    // over 32,764 bytes pads to 65536 and produces the same
    // 87,465-byte body — a 33,000-byte entry included. That is half
    // the cap, and the meter renders nothing below three quarters. So
    // for most of the range where this message can fire the meter is
    // not on screen, and pointing at it would be worse than silence.
    const message = codeToMessage(err('PAYLOAD_TOO_LARGE'), 'Could not save this entry');

    expect(message).not.toContain('size meter');

    // It says whose fault it is instead, because reaching it at all
    // means the app and the server disagree.
    expect(message).toContain('something is wrong with the app');
  });

  test('ITEM_TOO_LARGE points at the meter and names no figure either', () => {
    // Two codes, one boundary, and neither states it. A reader who
    // hits one and then the other must not be told two different
    // numbers — which is now guaranteed by neither telling them one.
    const client = codeToMessage(err('ITEM_TOO_LARGE'), 'Could not save this entry');
    const server = codeToMessage(err('PAYLOAD_TOO_LARGE'), 'Could not save this entry');

    // Guards first, for the reason given in the case above. No figure
    // in either, including the one this test used to REQUIRE — see
    // there for why '65,000' turned from an assertion into a guard.
    for (const message of [client, server]) {
      expect(message).not.toContain('64 KB');
      expect(message).not.toContain('32 KB');
      expect(message).not.toContain('65,000');
    }

    expect(client).toContain('notes');

    // This one CAN point at the meter: it is raised only from the
    // entry form, and an entry cannot be over the cap without being
    // past the three-quarter mark that makes the meter render.
    expect(client).toContain('size meter');

    // It is a real sentence, not the generic fallback with a code
    // bracketed onto it.
    expect(client).not.toContain('ITEM_TOO_LARGE');
    expect(client).not.toContain('Could not save this entry');
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
