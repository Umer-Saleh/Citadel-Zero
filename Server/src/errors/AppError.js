class AppError extends Error {
  constructor(code, statusCode, message) {
    super(message || code);
    this.name = 'AppError';
    this.code = code;               // machine-readable, e.g. 'EMAIL_TAKEN'
    this.statusCode = statusCode;   // what the client sees
    this.isOperational = true;      // expected failure, not a bug
  }
}

module.exports = { AppError };