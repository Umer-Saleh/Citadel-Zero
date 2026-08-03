/* eslint-disable camelcase */

exports.up = (pgm) => {
  // The same DEK, wrapped under a key derived from the recovery key.
  // An independent path to the vault that does not involve the
  // master password.
  pgm.addColumns('users', {
    recovery_wrapped_dek: { type: 'text' },
    recovery_wrapped_dek_nonce: { type: 'text' },
    recovery_wrapped_dek_tag: { type: 'text' },
    recovery_salt: { type: 'text' }
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('users', [
    'recovery_wrapped_dek',
    'recovery_wrapped_dek_nonce',
    'recovery_wrapped_dek_tag',
    'recovery_salt'
  ]);
};