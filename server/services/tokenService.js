import crypto from 'crypto';
import { config } from '../config.js';
import { DOSE_STATUS } from '../constants.js';

/**
 * Generates an HMAC-SHA256 signed, expiring token for one-click dose confirmation from emails.
 *
 * @param {Object} options
 * @param {string} options.doseId
 * @param {string} options.circleId
 * @param {string} [options.action='Taken']
 * @param {number} [options.expiresInHours=24]
 * @returns {string} URL-safe signed token
 */
export function generateOneClickToken({ doseId, circleId, action = DOSE_STATUS.TAKEN, expiresInHours = 24 }) {
  const expiresAt = Date.now() + expiresInHours * 60 * 60 * 1000;
  const payload = JSON.stringify({ doseId, circleId, action, expiresAt });
  const payloadB64 = Buffer.from(payload).toString('base64url');

  const secret = config.appSecret || 'carecircle-default-secret-key-32chars';
  const signature = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');

  return `${payloadB64}.${signature}`;
}

/**
 * Verifies the HMAC-SHA256 signature and expiration of a one-click confirmation token.
 * Uses constant-time comparison to prevent timing attacks.
 *
 * @param {string} token
 * @returns {{ valid: boolean, payload?: Object, error?: string, expired?: boolean }}
 */
export function verifyOneClickToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) {
    return { valid: false, error: 'Invalid token format.' };
  }

  const parts = token.split('.');
  if (parts.length !== 2) {
    return { valid: false, error: 'Invalid token structure.' };
  }

  const [payloadB64, signature] = parts;
  const secret = config.appSecret || 'carecircle-default-secret-key-32chars';
  const expectedSig = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');

  const bufSig = Buffer.from(signature);
  const bufExpected = Buffer.from(expectedSig);

  // Constant-time signature verification
  if (bufSig.length !== bufExpected.length || !crypto.timingSafeEqual(bufSig, bufExpected)) {
    return { valid: false, error: 'Token tampering detected: invalid signature.' };
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (!payload.expiresAt || Date.now() > payload.expiresAt) {
      return { valid: false, expired: true, error: 'Token has expired.' };
    }
    return { valid: true, payload };
  } catch (_err) {
    return { valid: false, error: 'Malformed token payload.' };
  }
}
