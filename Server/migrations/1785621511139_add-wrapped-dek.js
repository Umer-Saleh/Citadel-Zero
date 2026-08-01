/* eslint-disable camelcase */

exports.up = (pgm) => {
  // The DEK, encrypted under the password-derived KEK. The server
  // stores this but can never unwrap it.
  pgm.addColumns('users', {
    wrapped_dek: { type: 'text' },
    wrapped_dek_nonce: { type: 'text' },
    wrapped_dek_tag: { type: 'text' }
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('users', ['wrapped_dek', 'wrapped_dek_nonce', 'wrapped_dek_tag']);
};