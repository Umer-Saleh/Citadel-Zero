const { AppError } = require('../errors/AppError');

/**
 * Validates one part of the request against a zod schema and
 * replaces it with the parsed result, so downstream code sees
 * only data that has passed the schema.
 */
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      const detail = result.error.issues
        .map(i => `${i.path.join('.') || source}: ${i.message}`)
        .join('; ');

      return next(new AppError('VALIDATION_FAILED', 400, detail));
    }

    if (source === 'body') {
      req.body = result.data;
    } else {
      req.validated = { ...(req.validated || {}), [source]: result.data };
    }

    next();
  };
}

module.exports = { validate };