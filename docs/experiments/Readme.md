# JWT experiments

Throwaway scripts from the auth phase, kept because what they proved
is worth showing.

- `decode-token.js` — decodes a JWT's header and payload without
  verifying it, to make the point that the payload is base64, not
  encryption. Anything in a JWT is readable by whoever holds it.
- `forge-token.js` — takes a real token, rewrites its `sub` claim and
  prints the result with the original signature left in place. It
  sends nothing: to see the rejection, present the printed token as a
  bearer, and the server answers 401 `INVALID_TOKEN` because the
  signature no longer matches. The signature is what makes a JWT
  trustworthy, not the encoding. (The rewritten `sub` is an email
  address; the server's own tokens carry a user id there.)

Neither is part of the application. They are not imported anywhere.