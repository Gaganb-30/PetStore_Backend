/**
 * Input sanitisation middleware.
 *
 * Two jobs, both cheap and both done before any controller sees the data:
 *
 *  1. NoSQL injection — Mongo treats keys beginning with `$` as operators and
 *     keys containing `.` as paths. A body like `{ email: { $ne: null } }` would
 *     otherwise turn `findOne({ email })` into "any user". We drop such keys.
 *
 *  2. Reflected XSS — strip `<script>` blocks and inline event handlers from
 *     string values. Rich product descriptions are still allowed through as
 *     HTML (that's a deliberate admin-only feature), but the obvious script
 *     vectors are removed.
 *
 * Written in-house rather than via express-mongo-sanitize because that package
 * mutates `req.query`, which is a getter-only property on newer Express, and
 * this version sidesteps the problem by rewriting values in place.
 */

const FORBIDDEN_KEY = /^\$|\./;

const SCRIPT_TAG = /<script\b[^>]*>[\s\S]*?<\/script>/gi;
const EVENT_HANDLER = /\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const JS_PROTOCOL = /javascript\s*:/gi;

const cleanString = (value) => value
  .replace(SCRIPT_TAG, '')
  .replace(EVENT_HANDLER, '')
  .replace(JS_PROTOCOL, '');

/**
 * Recursively clean an object in place.
 * @param {any} value
 * @param {number} depth Guards against deeply nested payloads (DoS)
 */
const clean = (value, depth = 0) => {
  if (depth > 10 || value === null || typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      value[i] = typeof value[i] === 'string' ? cleanString(value[i]) : clean(value[i], depth + 1);
    }
    return value;
  }

  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEY.test(key)) {
      delete value[key];
      continue;
    }
    const child = value[key];
    if (typeof child === 'string') value[key] = cleanString(child);
    else clean(child, depth + 1);
  }
  return value;
};

const sanitize = (req, res, next) => {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) clean(req.body);
  if (req.params) clean(req.params);

  // req.query may be a getter on the request prototype, so mutate its contents
  // rather than reassigning the property itself.
  if (req.query && typeof req.query === 'object') clean(req.query);

  next();
};

export default sanitize;
