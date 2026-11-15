/**
 * CareCircle 360 - Async Route Handler Wrapper
 * Catches unhandled promise rejections in Express route handlers and forwards them to next(err).
 *
 * @param {Function} fn - Asynchronous Express handler (req, res, next) => Promise<any>
 * @returns {Function} Express middleware function
 */
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
