import express from 'express';
import bcrypt from 'bcryptjs';
import { getDb } from '../db.js';
import { generateLocalToken, verifyAuthToken } from '../middleware/auth.js';
import { config } from '../config.js';
import { seedDemoCareCircle, DEMO_CIRCLE_ID, DEMO_PASSCODE, DEMO_USERS } from '../services/seedService.js';

const router = express.Router();

/**
 * Public Firebase Web Client Config
 * Allows the frontend Firebase SDK to connect if environment variables are set.
 */
router.get('/config', (req, res) => {
  return res.json({
    success: true,
    firebase: {
      projectId: config.firebase.projectId,
      apiKey: config.firebase.apiKey,
      authDomain: config.firebase.authDomain,
      isConfigured: Boolean(config.firebase.projectId && config.firebase.apiKey)
    }
  });
});

/**
 * Register with email and password
 */
router.post('/register', async (req, res) => {
  try {
    const { email, password, name, role = 'elder' } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters long.' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const db = getDb();
    const usersCol = db.collection('users');
    const existingSnap = await usersCol.where('email', '==', cleanEmail).get();

    if (!existingSnap.empty) {
      return res.status(409).json({ success: false, error: 'An account with this email already exists.' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
    const uid = 'usr_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);

    const newUser = {
      uid,
      email: cleanEmail,
      name: (name && name.trim()) || cleanEmail.split('@')[0],
      passwordHash,
      defaultRole: role,
      createdAt: new Date().toISOString()
    };

    await usersCol.doc(uid).set(newUser);

    const token = generateLocalToken({
      uid: newUser.uid,
      email: newUser.email,
      name: newUser.name
    });

    return res.status(201).json({
      success: true,
      token,
      user: {
        uid: newUser.uid,
        email: newUser.email,
        name: newUser.name,
        defaultRole: newUser.defaultRole
      }
    });
  } catch (err) {
    console.error('Registration error:', err);
    return res.status(500).json({ success: false, error: 'Registration failed.' });
  }
});

/**
 * Login with email and password
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required.' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const db = getDb();
    const usersCol = db.collection('users');
    const existingSnap = await usersCol.where('email', '==', cleanEmail).get();

    if (existingSnap.empty) {
      return res.status(401).json({ success: false, error: 'Invalid email or password.' });
    }

    const user = existingSnap.docs[0].data();
    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      return res.status(401).json({ success: false, error: 'Invalid email or password.' });
    }

    const token = generateLocalToken({
      uid: user.uid,
      email: user.email,
      name: user.name
    });

    return res.json({
      success: true,
      token,
      user: {
        uid: user.uid,
        email: user.email,
        name: user.name,
        defaultRole: user.defaultRole
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ success: false, error: 'Authentication failed.' });
  }
});

/**
 * Demo accounts provider for judges/testers.
 * Seeds the demo care circle with elder, caretaker, and family member.
 */
router.post('/demo-login', async (req, res) => {
  try {
    const { persona = 'elder' } = req.body;
    await seedDemoCareCircle();

    const targetPersona = DEMO_USERS[persona] || DEMO_USERS.elder;
    const token = generateLocalToken(targetPersona);

    return res.json({
      success: true,
      token,
      user: targetPersona,
      circleId: DEMO_CIRCLE_ID,
      isDemo: true
    });
  } catch (err) {
    console.error('Demo login error:', err);
    return res.status(500).json({ success: false, error: 'Failed to provision demo account.' });
  }
});

/**
 * Reset demo environment to default seeded state.
 */
router.post('/reset-demo', async (req, res) => {
  try {
    const result = await seedDemoCareCircle();
    return res.json({
      success: true,
      message: 'Demo care circle successfully reset to default seeded state.',
      ...result
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to reset demo data.' });
  }
});

/**
 * Public endpoint describing demo accounts for judges and evaluators.
 */
router.get('/demo-info', (req, res) => {
  return res.json({
    success: true,
    disclaimer: 'ALL DATA IS SIMULATED DEMO DATA FOR CHALLENGE EVALUATION. NO REAL PATIENT DATA.',
    circle: {
      id: DEMO_CIRCLE_ID,
      name: 'Sharma Family Care Circle [DEMO DATA]',
      passcode: DEMO_PASSCODE
    },
    personas: DEMO_USERS
  });
});

/**
 * Get profile for authenticated user
 */
router.get('/me', verifyAuthToken, (req, res) => {
  return res.json({
    success: true,
    user: req.user
  });
});

/**
 * Get accessibility preferences for the authenticated user
 */
router.get('/preferences', verifyAuthToken, async (req, res) => {
  try {
    const db = getDb();
    const userDoc = await db.collection('users').doc(req.user.uid).get();

    const defaultPrefs = {
      fontSize: 'normal',
      highContrast: false,
      reduceMotion: false,
      voiceEnabled: false,
      elderSimpleMode: req.user.role === 'elder'
    };

    const preferences = userDoc.exists && userDoc.data().preferences
      ? { ...defaultPrefs, ...userDoc.data().preferences }
      : defaultPrefs;

    return res.json({
      success: true,
      preferences
    });
  } catch (err) {
    console.error('Get preferences error:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve accessibility preferences.' });
  }
});

/**
 * Update accessibility preferences for the authenticated user.
 * Validates text size (3 levels), high contrast, reduce motion, voice reading, and elder simple mode.
 */
router.put('/preferences', verifyAuthToken, async (req, res) => {
  try {
    const { preferences } = req.body;
    if (!preferences || typeof preferences !== 'object') {
      return res.status(400).json({ success: false, error: 'Preferences object is required.' });
    }

    const { fontSize, highContrast, reduceMotion, voiceEnabled, elderSimpleMode } = preferences;

    // Validation: text size must be at least 3 levels ('normal', 'large', 'xlarge')
    if (fontSize !== undefined && !['normal', 'large', 'xlarge'].includes(fontSize)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid fontSize. Must be "normal", "large", or "xlarge".'
      });
    }

    const db = getDb();
    const userRef = db.collection('users').doc(req.user.uid);
    const userDoc = await userRef.get();

    const existingPrefs = userDoc.exists ? (userDoc.data().preferences || {}) : {};

    const updatedPrefs = {
      ...existingPrefs,
      ...(fontSize !== undefined && { fontSize }),
      ...(highContrast !== undefined && { highContrast: Boolean(highContrast) }),
      ...(reduceMotion !== undefined && { reduceMotion: Boolean(reduceMotion) }),
      ...(voiceEnabled !== undefined && { voiceEnabled: Boolean(voiceEnabled) }),
      ...(elderSimpleMode !== undefined && { elderSimpleMode: Boolean(elderSimpleMode) })
    };

    if (userDoc.exists) {
      await userRef.update({ preferences: updatedPrefs });
    } else {
      await userRef.set({ uid: req.user.uid, preferences: updatedPrefs }, { merge: true });
    }

    return res.json({
      success: true,
      message: 'Accessibility preferences updated successfully.',
      preferences: updatedPrefs
    });
  } catch (err) {
    console.error('Update preferences error:', err);
    return res.status(500).json({ success: false, error: 'Failed to save accessibility preferences.' });
  }
});

export default router;
