import { describe, test, expect } from 'vitest';
import { APP_PATHS, isAppPath } from './appPaths';

/**
 * The allowlist that decides whether a URL is the application.
 *
 * nginx answers every unmatched path with index.html, so the browser
 * gets the whole app at any address and React is the only thing that
 * can tell /vault from /wp-admin. This list is that judgement, and it
 * is small enough to state exhaustively.
 */

describe('paths that are the application', () => {
  test('the root is', () => {
    expect(isAppPath('/')).toBe(true);
  });

  test('index.html is, because nginx serves it as a real file', () => {
    expect(isAppPath('/index.html')).toBe(true);
  });

  test('the list is exactly those two', () => {
    // Deliberately exhaustive. Growing this list is a decision with a
    // consequence — see the header of appPaths.js — so it should not
    // grow without a test changing too.
    expect(APP_PATHS).toEqual(['/', '/index.html']);
  });
});

describe('paths that are not', () => {
  test.each([
    ['/anything'],
    ['/vault'],
    ['/wp-admin'],
    ['/.env'],
    ['/index.htm'],
    ['//'],
    ['/ '],
    ['']
  ])('%s is not the application', (pathname) => {
    expect(isAppPath(pathname)).toBe(false);
  });

  test('a trailing slash is not the root', () => {
    // nginx's try_files would serve index.html here too, and it is
    // genuinely a different address. Called out rather than left to be
    // inferred, because it is the one a reader is most likely to
    // assume goes the other way.
    expect(isAppPath('/vault/')).toBe(false);
  });
});

describe('what the check must not look at', () => {
  test('only a pathname is ever passed, so a hash cannot reach it', () => {
    // Several pre-auth links are href="#" with preventDefault. Those
    // set location.hash and leave pathname alone, so the root stays
    // the root. If this check ever grew to include hash or search,
    // every one of those links would land the user on a 404.
    expect(isAppPath('/')).toBe(true);

    // A hash that did leak into the pathname is correctly rejected —
    // proof the function is a plain exact match with no parsing that
    // could accidentally tolerate one.
    expect(isAppPath('/#')).toBe(false);
    expect(isAppPath('/?q=1')).toBe(false);
  });
});
