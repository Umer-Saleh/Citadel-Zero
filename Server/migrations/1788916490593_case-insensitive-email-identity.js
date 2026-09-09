/* eslint-disable camelcase */

/**
 * Make an account's identity case-insensitive.
 *
 * `email` is `text UNIQUE`, and Postgres compares text case
 * sensitively, so Reviewer@Example.com and reviewer@example.com were
 * two separate accounts with separate vaults, separate DEKs and
 * separate recovery keys. Nothing on either side folded case, so a
 * person who capitalised inconsistently between visits silently landed
 * in a DIFFERENT account — an empty one — and reasonably concluded
 * their data was gone.
 *
 * WHY AN INDEX ON lower(email) RATHER THAN FOLDING ON THE WAY IN
 * -------------------------------------------------------------
 * Lowercasing at the validation boundary would work only for as long
 * as every writer remembers to do it, which puts the guarantee in
 * application code — exactly where it just failed. Here the database
 * holds it. A lookup that forgets to fold fails as "no such account":
 * visible, recoverable, and it still cannot create a second colliding
 * account, because this index refuses. When the harm is "my data is
 * gone", a loud failure beats a silent one.
 *
 * The stored value is NOT rewritten. The address is preserved exactly
 * as the person typed it, and only comparison folds — see
 * repositories/userRepo.js. Folding storage would discard information
 * for no gain and would be irreversible, and RFC 5321 §2.4 is explicit
 * that a mailbox local-part is case SENSITIVE by spec. That rule
 * governs mail delivery, and this system never sends mail — the
 * address is a login handle — which is why folding for comparison is
 * safe here. It would stop being obviously safe the day this app
 * starts sending mail, and preserving the stored value is what keeps
 * that door open.
 *
 * The column's own UNIQUE constraint stays. It is now redundant with
 * this index, and harmless.
 */

// Named explicitly rather than left to node-pg-migrate's generator,
// because `down` has to drop it by name and an expression index does
// not get an obvious one.
const INDEX = 'users_email_lower_key';

exports.up = (pgm) => {
  // Refuse rather than pick a winner.
  //
  // Two accounts that differ only by case have independent DEKs. They
  // cannot be merged, and neither can be deleted, without the master
  // password for BOTH — which the server does not have and by design
  // never will. Any automatic resolution here silently destroys
  // somebody's vault, so the only honest behaviour is to stop and say
  // which addresses are involved.
  //
  // CREATE UNIQUE INDEX below would fail on a collision anyway. This
  // block exists so the operator reads the addresses rather than a
  // bare duplicate-key violation on an expression they have to
  // reverse-engineer.
  pgm.sql(`
    DO $$
    DECLARE
      collisions text;
      n int;
    BEGIN
      SELECT count(*), string_agg(e, ', ' ORDER BY e)
        INTO n, collisions
        FROM (
          SELECT lower(email) AS e
            FROM users
           GROUP BY lower(email)
          HAVING count(*) > 1
        ) c;

      IF n > 0 THEN
        RAISE EXCEPTION
          'Cannot make email identity case-insensitive: % address(es) exist in more than one casing: %',
          n, collisions
        USING HINT =
          'Each casing is a separate vault with its own key. They cannot be merged server-side. Resolve by hand, then re-run.';
      END IF;
    END $$;
  `);

  pgm.sql(`CREATE UNIQUE INDEX ${INDEX} ON users (lower(email));`);
};

exports.down = (pgm) => {
  // Only the index goes. Nothing was rewritten on the way up, so there
  // is no data to restore.
  pgm.sql(`DROP INDEX IF EXISTS ${INDEX};`);
};
