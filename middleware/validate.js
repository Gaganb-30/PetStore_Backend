import { validationResult } from 'express-validator';

/**
 * Validation middleware — runs express-validator checks and returns errors if any
 * Usage: router.post('/route', [body('email').isEmail(), ...], validate, controller)
 */
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const extractedErrors = errors.array().map((err) => ({
      field: err.path,
      message: err.msg,
    }));
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: extractedErrors,
    });
  }
  next();
};

export default validate;
