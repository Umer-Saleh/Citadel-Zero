import { describe, test, expect } from 'vitest';
import { ErrorNote, SuccessNote } from './ui';
import { texts, walk } from '../test/hookShim.js';

/**
 * The one red line, and the announcement it used to lack.
 *
 * This markup was copied thirteen times across six files and not one
 * copy carried a role or an aria-live, so a screen reader was never
 * told an error had appeared: someone who could not see the screen
 * pressed UNLOCK and got silence.
 *
 * ErrorNote takes no hooks, so it renders by calling it.
 */

describe('ErrorNote', () => {
  test('announces itself', () => {
    // role="alert" is assertive on purpose: the user has just acted and
    // is waiting on the answer.
    expect(ErrorNote({ message: 'Wrong email or master password.' }).props.role)
      .toBe('alert');
  });

  test('renders the message', () => {
    const el = ErrorNote({ message: 'Cannot reach the server.' });
    expect(el.props.children).toBe('Cannot reach the server.');
  });

  test('renders nothing at all when there is no message', () => {
    // Callers write <ErrorNote message={error} /> with no surrounding
    // guard, so an empty slot must not leave an announced empty region
    // for a screen reader to find.
    expect(ErrorNote({ message: '' })).toBe(null);
    expect(ErrorNote({ message: null })).toBe(null);
    expect(ErrorNote({ message: undefined })).toBe(null);
  });

  test('keeps the retro-terminal styling the sites it replaced had', () => {
    const { style } = ErrorNote({ message: 'x' }).props;

    expect(style.color).toBe('var(--red)');
    expect(style.fontSize).toBe(13);
  });

  test('a caller can add to the style without losing the role', () => {
    const el = ErrorNote({ message: 'x', style: { marginTop: 8 } });

    expect(el.props.style.marginTop).toBe(8);
    expect(el.props.style.color).toBe('var(--red)');
    expect(el.props.role).toBe('alert');
  });
});

describe('SuccessNote', () => {
  test('is polite, not assertive', () => {
    // role="status", deliberately not "alert". A confirmation waits for
    // a pause; announcing it assertively would make success interrupt
    // like a problem. That difference is why this is a separate
    // component rather than a tone prop on ErrorNote.
    expect(SuccessNote({ label: 'KEY DOWNLOADED' }).props.role).toBe('status');
  });

  test('renders the label, and the detail when there is one', () => {
    const withDetail = SuccessNote({ label: 'TWO-FACTOR TURNED OFF', children: 'Only your master password now.' });
    expect(texts(withDetail)).toContain('TWO-FACTOR TURNED OFF');
    expect(texts(withDetail)).toContain('Only your master password now.');

    const bare = SuccessNote({ label: 'SAVED' });
    expect(texts(bare)).toContain('SAVED');
  });

  test('renders nothing without a label', () => {
    expect(SuccessNote({ label: '' })).toBe(null);
    expect(SuccessNote({ label: null })).toBe(null);
  });

  test('is green, so it cannot be mistaken for the red failure slot', () => {
    const el = SuccessNote({ label: 'DONE' });
    const labelSpan = [...walk(el)].find(n => n?.props?.style?.color === 'var(--green)');
    expect(labelSpan).toBeDefined();
  });
});
