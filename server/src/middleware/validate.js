import { PantaError } from '../panta/errors.js';

export function validate(schema) {
  return (req, _res, next) => {
    try {
      const parsed = schema.parse(req.body);
      req.body = parsed;
      next();
    } catch (e) {
      if (e.name === 'ZodError') {
        return next(new PantaError('VALIDATION_ERROR', 'Invalid input', { status: 400, details: e.errors ?? e.issues }));
      }
      next(e);
    }
  };
}

export function validateParams(schema) {
  return (req, _res, next) => {
    try {
      schema.parse(req.params);
      next();
    } catch (e) {
      return next(new PantaError('VALIDATION_ERROR', 'Invalid params', { status: 400, details: e.errors ?? e.issues }));
    }
  };
}
