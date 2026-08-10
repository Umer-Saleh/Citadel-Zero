/* eslint-disable camelcase */

exports.up = (pgm) => {
  pgm.addColumns('users', {
    // Base32 shared secret. Stored in PLAINTEXT, unavoidably — TOTP is
    // symmetric, so the server must hold the same secret the phone
    // does in order to compute the expected code. This is exactly why
    // nothing in the key hierarchy derives from it: a database leak
    // exposes it, and that must not touch the vault's security.
    totp_secret: { type: 'text' },

    // Separate from the secret being non-null: enrolment generates a
    // secret and shows a QR code, but 2FA is only ENABLED once the
    // user proves they scanned it by entering a valid code. A secret
    // with enabled=false is a half-finished enrolment.
    totp_enabled: { type: 'boolean', notNull: true, default: false },

    // The last time-step consumed, to reject replays. A code is valid
    // for 30 seconds; without this, an attacker who observes one can
    // reuse it inside that window.
    totp_last_step: { type: 'bigint' }
  });

  pgm.createTable('totp_backup_codes', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    user_id: {
      type: 'uuid', notNull: true,
      references: 'users', onDelete: 'CASCADE'
    },
    // SHA-256, same reasoning as refresh tokens: high-entropy random
    // input, so there's nothing for a slow hash to protect against.
    code_hash: { type: 'text', notNull: true },
    used_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  });

  pgm.createIndex('totp_backup_codes', 'user_id');
  pgm.createIndex('totp_backup_codes', 'code_hash', { unique: true });
};

exports.down = (pgm) => {
  pgm.dropTable('totp_backup_codes');
  pgm.dropColumns('users', ['totp_secret', 'totp_enabled', 'totp_last_step']);
};