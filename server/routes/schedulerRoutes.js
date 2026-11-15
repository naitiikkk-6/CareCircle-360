import express from 'express';
import { config } from '../config.js';
import { runSchedulerCycle, generateDailyCarePulse } from '../services/schedulerService.js';
import { sentEmailsLog } from '../services/emailService.js';
import { verifyAuthToken } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = express.Router();

/**
 * Cloud Scheduler webhook trigger for reminders & missed dose escalations.
 * Protected by SCHEDULER_SECRET header or Bearer token.
 */
router.post(
  '/check-reminders',
  asyncHandler(async (req, res) => {
    const providedSecret =
      req.headers['x-scheduler-secret'] || req.headers.authorization?.replace('Bearer ', '');

    // Allow if matching SCHEDULER_SECRET or if run in development
    const isAuthorized =
      providedSecret === config.schedulerSecret || process.env.NODE_ENV !== 'production';

    if (!isAuthorized) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized scheduler trigger.'
      });
    }

    const circleId = req.body?.circleId || req.query?.circleId || null;
    const result = await runSchedulerCycle({ circleId });

    return res.json({
      success: true,
      message: 'Scheduler cycle executed successfully.',
      result
    });
  })
);

/**
 * Trigger Daily Care Pulse calculation & email dispatch.
 */
router.post(
  '/daily-pulse',
  asyncHandler(async (req, res) => {
    const circleId = req.body?.circleId;
    if (!circleId) {
      return res.status(400).json({ success: false, error: 'circleId is required.' });
    }

    const record = await generateDailyCarePulse(circleId);
    return res.json({
      success: true,
      message: 'Daily Care Pulse calculated and notification dispatched.',
      record
    });
  })
);

/**
 * Audit log of sent email reminders & escalations (accessible for inspection in UI)
 */
router.get('/audit-logs', verifyAuthToken, (req, res) => {
  return res.json({
    success: true,
    count: sentEmailsLog.length,
    logs: [...sentEmailsLog].reverse().slice(0, 30) // Recent 30 emails
  });
});

export default router;
