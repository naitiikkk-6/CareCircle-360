import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

// Global API rate limiter: 100 requests per 15 minutes per IP
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 150,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many requests from this IP, please try again after 15 minutes.'
  }
});

// Passcode join brute-force protection: max 5 attempts per 10 minutes per IP
export const passcodeJoinLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error:
      'Too many join attempts. For security reasons, please wait 10 minutes before trying again.'
  }
});

// AI analysis rate limiter: 15 requests per 5 minutes
export const aiScanLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'AI scan rate limit reached. Please wait a few moments before scanning again.'
  }
});

// Helmet configuration with Content Security Policy compatible with local scripts, fonts & inline styles
export const helmetConfig = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false
});

// Input sanitization middleware: strips HTML script injection and trims strings
export function sanitizeInputs(req, res, next) {
  if (req.body && typeof req.body === 'object') {
    sanitizeObject(req.body);
  }
  if (req.query && typeof req.query === 'object') {
    sanitizeObject(req.query);
  }
  next();
}

function sanitizeObject(obj) {
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (typeof val === 'string') {
      // Disallow executable script tags or javascript pseudoprotocol
      obj[key] = val
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/javascript:/gi, '')
        .trim();
    } else if (typeof val === 'object' && val !== null) {
      sanitizeObject(val);
    }
  }
}
