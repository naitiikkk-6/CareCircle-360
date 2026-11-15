import jwt from 'jsonwebtoken';
import { admin, isUsingRealFirestore } from '../db.js';
import { config } from '../config.js';

export async function verifyAuthToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required. Missing or malformed authorization header.'
    });
  }

  const token = authHeader.split(' ')[1];

  // Try Firebase ID token first if real Firebase is available
  if (isUsingRealFirestore()) {
    try {
      const decodedFirebaseToken = await admin.auth().verifyIdToken(token);
      req.user = {
        uid: decodedFirebaseToken.uid,
        email: decodedFirebaseToken.email || '',
        name: decodedFirebaseToken.name || decodedFirebaseToken.email?.split('@')[0] || 'User',
        authType: 'firebase'
      };
      return next();
    } catch (_fbErr) {
      // If Firebase verification fails, check if it's a signed local token
    }
  }

  // Fallback to JWT token verification (used for offline development, local mock, and automated tests)
  try {
    const decoded = jwt.verify(token, config.appSecret);
    req.user = {
      uid: decoded.uid || decoded.id,
      email: decoded.email || '',
      name: decoded.name || 'User',
      authType: 'jwt'
    };
    return next();
  } catch (_err) {
    return res.status(401).json({
      success: false,
      error: 'Invalid or expired authorization token.'
    });
  }
}

export function generateLocalToken(payload) {
  return jwt.sign(payload, config.appSecret, { expiresIn: '7d' });
}
