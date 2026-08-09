/* eslint-disable camelcase */

exports.up = (pgm) => {
  pgm.createTable('refresh_tokens', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },

    // Every token descended from one login shares a family_id.
    // Rotation carries it forward. Reuse anywhere in the chain
    // revokes the whole family, because "this session is
    // compromised" is a fact about the session, not one token.
    family_id: { type: 'uuid', notNull: true },

    user_id: {
      type: 'uuid',
      notNull: true,
      references: 'users',
      onDelete: 'CASCADE'
    },

    // SHA-256 of the token, never the token itself. A refresh token
    // is a credential — a database leak must not hand an attacker
    // live sessions. Argon2 would be overkill here and too slow on
    // a hot path: the input is 32 bytes of CSPRNG output, so there
    // is no low-entropy guess to slow down.
    token_hash: { type: 'text', notNull: true, unique: true },

    // Set on rotation. A non-null used_at coming back through the
    // refresh endpoint is the reuse signal.
    used_at: { type: 'timestamptz' },

    // Set when the family is killed — by reuse detection, by logout,
    // or by a password change. Kept separate from used_at so the
    // logs can tell "spent normally" from "revoked as compromised".
    revoked_at: { type: 'timestamptz' },

    expires_at: { type: 'timestamptz', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  });

  // Every refresh looks a token up by hash.
  pgm.createIndex('refresh_tokens', 'token_hash');

  // Reuse detection revokes a whole family at once.
  pgm.createIndex('refresh_tokens', 'family_id');

  // Password change revokes every session a user has.
  pgm.createIndex('refresh_tokens', 'user_id');
};

exports.down = (pgm) => {
  pgm.dropTable('refresh_tokens');
};