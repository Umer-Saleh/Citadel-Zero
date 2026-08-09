# JWT experiments

Throwaway scripts from the auth phase, kept because what they proved
is worth showing.

- `decode-token.js` — decodes a JWT's header and payload without
  verifying it, to make the point that the payload is base64, not
  encryption. Anything in a JWT is readable by whoever holds it.
- `forge-token.js` — builds a token with a tampered payload and a
  wrong signature, and confirms the server rejects it. The signature
  is what makes a JWT trustworthy, not the encoding.

Neither is part of the application. They are not imported anywhere.