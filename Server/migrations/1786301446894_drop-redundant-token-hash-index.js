/* eslint-disable camelcase */

exports.up = (pgm) => {
  // The unique constraint on token_hash already builds its own index,
  // so the explicit one added alongside it was a second identical
  // B-tree — maintained on every insert, used by nothing.
  pgm.dropIndex('refresh_tokens', 'token_hash');
};

exports.down = (pgm) => {
  pgm.createIndex('refresh_tokens', 'token_hash');
};