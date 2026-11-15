import express from 'express';
import crypto from 'crypto';
import { config } from '../config.js';
import { runCronReminders } from '../services/schedulerService.js';

const router = express.Router();

/**
 * Constant-time comparison between user-provided secret and expected environment secret.
 * Prevents timing attacks on the cron trigger endpoint.
 */
export function safeCompare(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') {
    return false;
  }

  const bufProvided = Buffer.from(provided);
  const bufExpected = Buffer.from(expected);

  if (bufProvided.length !== bufExpected.length) {
    // Constant-time dummy comparison to prevent timing leak on secret length
    crypto.timingSafeEqual(bufExpected, bufExpected);
    return false;
  }

  return crypto.timingSafeEqual(bufProvided, bufExpected);
}

/**
 * Middleware: Requires secret header compared in constant-time.
 * Accepts x-cron-secret, x-scheduler-secret, or Authorization: Bearer <secret>.
 */
export function verifyCronSecret(req, res, next) {
  const provided = req.headers['x-cron-secret'] ||
    req.headers['x-scheduler-secret'] ||
    (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7).trim() : null);

  const expected = config.cronSecret || config.schedulerSecret;

  if (!provided || !expected || !safeCompare(provided, expected)) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Secret header required.'
    });
  }

  next();
}

/**
 * POST /api/cron/reminders
 * Protected endpoint for Cloud Scheduler cron job (e.g. every 5 minutes).
 * Performs:
 *  (a) Email about doses due within the next 15 minutes
 *  (b) Mark overdue doses as Missed and email about them
 *  (c) Email about appointments in the next 24 hours
 *  - Prevents duplicate emails
 *  - Enforces elder alert preferences
 */
router.post('/reminders', verifyCronSecret, async (req, res) => {
  try {
    const { circleId, referenceDate, includeWeeklySummary, forceWeeklySummary } = req.body || {};
    const referenceDateObj = referenceDate ? new Date(referenceDate) : null;

    const result = await runCronReminders({
      circleId: circleId || null,
      referenceDateObj,
      includeWeeklySummary: Boolean(includeWeeklySummary),
      forceWeeklySummary: Boolean(forceWeeklySummary)
    });

    return res.json({
      success: true,
      message: 'Cron reminders executed successfully.',
      result
    });
  } catch (err) {
    console.error('Cron reminders error:', err);
    return res.status(500).json({
      success: false,
      error: 'Failed to execute cron reminders.'
    });
  }
});

/**
 * POST /api/cron/weekly-summary
 * Dedicated Cloud Scheduler endpoint for weekly digest dispatch.
 */
router.post('/weekly-summary', verifyCronSecret, async (req, res) => {
  try {
    const { circleId, referenceDate, forceSend } = req.body || {};
    const referenceDateObj = referenceDate ? new Date(referenceDate) : null;

    const result = await runCronReminders({
      circleId: circleId || null,
      referenceDateObj,
      includeWeeklySummary: true,
      forceWeeklySummary: forceSend !== undefined ? Boolean(forceSend) : true
    });

    return res.json({
      success: true,
      message: 'Weekly family summary dispatched.',
      result
    });
  } catch (err) {
    console.error('Cron weekly summary error:', err);
    return res.status(500).json({
      success: false,
      error: 'Failed to dispatch weekly summary.'
    });
  }
});

export default router;
