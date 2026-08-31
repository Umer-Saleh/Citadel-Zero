/* eslint-disable camelcase */

exports.up = (pgm) => {
  // Proof of possession for the recovery key.
  //
  // The client derives TWO independent values from the recovery key,
  // separated by their HKDF info label: "recovery-kek" unwraps the
  // DEK, "recovery-auth" is sent to the server. This column holds
  // serverStoreAuth() of the second — an Argon2 hash of a hash, the
  // same treatment auth_hash gets. The server still never sees the
  // recovery key itself, and the value stored here cannot unwrap
  // anything.
  //
  // Without it, POST /api/account/recover verified nothing: anyone
  // knowing an email could overwrite the credentials and both DEK
  // wrappers, permanently bricking the account.
  //
  // NULLABLE, and deliberately so. Accounts that predate this
  // migration have no verifier and cannot be given one — deriving it
  // requires the recovery key, which only the user holds. Those rows
  // stay NULL and completeRecovery refuses them rather than falling
  // back to the old unverified path.
  pgm.addColumns("users", {
    recovery_auth_hash: { type: "text" }
  });
};

exports.down = (pgm) => {
  pgm.dropColumns("users", ["recovery_auth_hash"]);
};
