import express from 'express';
import { getDb } from '../db.js';
import { verifyAuthToken } from '../middleware/auth.js';
import {
  requireCircleAccess,
  requireDoseLogPermission,
  requireViewDosesPermission
} from '../middleware/permissions.js';
import {
  generateDoseInstancesForCircle,
  getLocalDateInTimezone,
  evaluateGraceWindowForMissedDoses,
  calculateAdherenceForRange
} from '../services/doseService.js';
import { calculateDailyCarePulse } from '../services/pulseService.js';
import { logCircleActivity } from '../services/activityService.js';
import { verifyOneClickToken } from '../services/tokenService.js';

const router = express.Router();

/**
 * Get dose tracking records for a specific date (default: today in circle's timezone).
 * Automatically generates dose instances for today and next 7 days from active schedules.
 */
router.get('/', verifyAuthToken, requireCircleAccess, requireViewDosesPermission, async (req, res) => {
  try {
    const db = getDb();
    const circleTimezone = req.circle.timezone || 'Asia/Kolkata';
    const todayInTimezone = getLocalDateInTimezone(new Date(), circleTimezone);
    const dateStr = req.query.date || todayInTimezone;

    // Automatically synchronize dose instances for current day + next 7 days
    await generateDoseInstancesForCircle(req.circle, 7);

    // Fetch dose logs for the target date
    const doseSnap = await db.collection('doseLogs')
      .where('circleId', '==', req.circle.id)
      .where('scheduledDate', '==', dateStr)
      .get();

    const doses = [];
    doseSnap.forEach(d => doses.push(d.data()));

    // Sort by scheduled time
    doses.sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime));

    return res.json({
      success: true,
      circleId: req.circle.id,
      date: dateStr,
      timezone: circleTimezone,
      doses
    });
  } catch (err) {
    console.error('Get doses error:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve dose tracking records.' });
  }
});

/**
 * Get dose instances for a date range (e.g. today + 7 days).
 */
router.get('/range', verifyAuthToken, requireCircleAccess, requireViewDosesPermission, async (req, res) => {
  try {
    const db = getDb();
    const daysAhead = parseInt(req.query.days || '7', 10);
    const circleTimezone = req.circle.timezone || 'Asia/Kolkata';

    // Synchronize doses
    const genResult = await generateDoseInstancesForCircle(req.circle, daysAhead);

    // Fetch all doses for this circle
    const doseSnap = await db.collection('doseLogs')
      .where('circleId', '==', req.circle.id)
      .get();

    const allDoses = [];
    doseSnap.forEach(d => allDoses.push(d.data()));

    const targetDates = new Set(genResult.dates);
    const filteredDoses = allDoses.filter(d => targetDates.has(d.scheduledDate));

    filteredDoses.sort((a, b) => {
      if (a.scheduledDate !== b.scheduledDate) return a.scheduledDate.localeCompare(b.scheduledDate);
      return a.scheduledTime.localeCompare(b.scheduledTime);
    });

    return res.json({
      success: true,
      circleId: req.circle.id,
      timezone: circleTimezone,
      dates: genResult.dates,
      totalDoses: filteredDoses.length,
      doses: filteredDoses
    });
  } catch (err) {
    console.error('Get dose range error:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve dose range.' });
  }
});

/**
 * Log or update dose status: 'Taken', 'Missed', or 'Pending'.
 * Requires Elder authority or permission for Caretaker / Family.
 * Records audit metadata: who changed it, when, and notes.
 */
const updateDoseStatusHandler = async (req, res) => {
  try {
    const doseId = req.params.id || req.body.doseId;
    const { status, notes = '', missedReason = '' } = req.body;

    if (!doseId || !['Taken', 'Missed', 'Pending'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Valid doseId and status ("Taken", "Missed", or "Pending") are required.'
      });
    }

    const db = getDb();
    const doseRef = db.collection('doseLogs').doc(doseId);
    const doseDoc = await doseRef.get();

    if (!doseDoc.exists || doseDoc.data().circleId !== req.circle.id) {
      return res.status(404).json({ success: false, error: 'Dose record not found in this circle.' });
    }

    const updates = {
      status,
      notes: typeof notes === 'string' ? notes.trim() : '',
      missedReason: status === 'Missed' ? (missedReason.trim() || 'Logged as missed') : '',
      loggedAt: new Date().toISOString(),
      loggedBy: {
        uid: req.user.uid,
        name: req.user.name,
        role: req.userRole
      }
    };

    await doseRef.update(updates);
    const updated = { ...doseDoc.data(), ...updates };

    await logCircleActivity({
      circleId: req.circle.id,
      action: `DOSE_${status.toUpperCase()}`,
      details: `${req.user.name} marked ${doseDoc.data().medicineName || 'dose'} as ${status}`,
      actor: req.user
    });

    return res.json({
      success: true,
      message: `Dose marked as ${status}.`,
      dose: updated
    });
  } catch (err) {
    console.error('Log dose error:', err);
    return res.status(500).json({ success: false, error: 'Failed to log dose status.' });
  }
};

router.post('/log', verifyAuthToken, requireCircleAccess, requireDoseLogPermission, updateDoseStatusHandler);
router.put('/:id/status', verifyAuthToken, requireCircleAccess, requireDoseLogPermission, updateDoseStatusHandler);
router.put('/:id', verifyAuthToken, requireCircleAccess, requireDoseLogPermission, updateDoseStatusHandler);

/**
 * Evaluate grace window for missed doses (default grace window: 60 minutes).
 * Can be called by scheduler webhook or manual check.
 */
router.post('/evaluate-grace', verifyAuthToken, requireCircleAccess, async (req, res) => {
  try {
    const graceWindowMinutes = parseInt(req.body.graceWindowMinutes || '60', 10);
    const result = await evaluateGraceWindowForMissedDoses({
      circle: req.circle,
      graceWindowMinutes
    });

    return res.json({
      success: true,
      message: `Grace window evaluation completed (${graceWindowMinutes} mins window).`,
      result
    });
  } catch (err) {
    console.error('Grace window evaluation error:', err);
    return res.status(500).json({ success: false, error: 'Failed to evaluate grace window.' });
  }
});

/**
 * Adherence Calculation for a date range (ignoring future pending doses).
 * Formula: taken / total due (where total due = taken + missed).
 */
router.get('/adherence', verifyAuthToken, requireCircleAccess, requireViewDosesPermission, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const adherenceData = await calculateAdherenceForRange({
      circle: req.circle,
      startDate: startDate || null,
      endDate: endDate || null
    });

    return res.json({
      success: true,
      adherence: adherenceData
    });
  } catch (err) {
    console.error('Calculate adherence error:', err);
    return res.status(500).json({ success: false, error: 'Failed to calculate adherence.' });
  }
});

/**
 * History view: returns adherence percentage and list of missed doses.
 */
router.get('/history', verifyAuthToken, requireCircleAccess, requireViewDosesPermission, async (req, res) => {
  try {
    const days = parseInt(req.query.days || '30', 10);
    const now = new Date();
    const startDateObj = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const circleTimezone = req.circle.timezone || 'Asia/Kolkata';

    const startDate = getLocalDateInTimezone(startDateObj, circleTimezone);
    const endDate = getLocalDateInTimezone(now, circleTimezone);

    const historyData = await calculateAdherenceForRange({
      circle: req.circle,
      startDate,
      endDate
    });

    return res.json({
      success: true,
      history: {
        circleId: req.circle.id,
        elderName: req.circle.elderName,
        periodDays: days,
        startDate,
        endDate,
        adherencePercentage: historyData.adherencePercentage,
        totalDue: historyData.totalDue,
        takenCount: historyData.takenCount,
        missedCount: historyData.missedCount,
        futurePendingCount: historyData.futurePendingCount,
        missedDoses: historyData.missedDoses
      }
    });
  } catch (err) {
    console.error('History view error:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve dose history.' });
  }
});

/**
 * Daily Care Pulse Summary for the circle
 */
router.get('/pulse', verifyAuthToken, requireCircleAccess, requireViewDosesPermission, async (req, res) => {
  try {
    const targetDateStr = req.query.date || null;
    const pulseData = await calculateDailyCarePulse({
      circle: req.circle,
      targetDateStr
    });

    return res.json({
      success: true,
      pulse: {
        ...pulseData,
        // Backward-compatible aliases if tests or frontends expect them
        taken: pulseData.takenCount,
        missed: pulseData.missedCount,
        pending: pulseData.pendingCount,
        totalDoses: pulseData.totalDosesToday,
        statusText: pulseData.statusTextBadge
      }
    });
  } catch (err) {
    console.error('Pulse error:', err);
    return res.status(500).json({ success: false, error: 'Failed to generate care pulse.' });
  }
});

/**
 * One-Click Dose Confirmation (Expiring HMAC Token).
 * Called when the Elder clicks the confirmation link in a missed dose escalation email.
 * Accepts GET (from email link click in browser) and POST (from API clients).
 * Rejects expired or tampered tokens with constant-time verification.
 */
const handleOneClickConfirm = async (req, res) => {
  try {
    const token = req.query.token || req.body?.token;

    if (!token) {
      return res.status(400).json({
        success: false,
        error: 'Confirmation token is required.'
      });
    }

    const verification = verifyOneClickToken(token);

    if (!verification.valid) {
      if (verification.expired) {
        if (req.accepts('html') && req.method === 'GET') {
          return res.status(400).send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>Confirmation Link Expired - CareCircle 360</title>
              <style>
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8f9fa; padding: 24px; text-align: center; color: #202124; }
                .card { max-width: 480px; margin: 40px auto; background: white; padding: 32px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.08); border: 2px solid #ea4335; }
                h1 { color: #ea4335; font-size: 24px; margin-bottom: 12px; }
                p { font-size: 16px; line-height: 1.5; color: #5f6368; }
                .btn { display: inline-block; margin-top: 20px; padding: 12px 24px; background: #0b57d0; color: white; text-decoration: none; border-radius: 6px; font-weight: bold; }
              </style>
            </head>
            <body>
              <div class="card">
                <h1>⏳ Link Expired</h1>
                <p>This dose confirmation link has expired for security reasons.</p>
                <p>Please open CareCircle 360 to log your medication.</p>
                <a href="/" class="btn">Open CareCircle 360</a>
              </div>
            </body>
            </html>
          `);
        }
        return res.status(400).json({
          success: false,
          error: 'Confirmation link has expired.',
          expired: true
        });
      }

      return res.status(400).json({
        success: false,
        error: verification.error || 'Invalid confirmation token or tampering detected.'
      });
    }

    const { doseId, circleId, action = 'Taken' } = verification.payload;
    const db = getDb();
    const doseRef = db.collection('doseLogs').doc(doseId);
    const doseDoc = await doseRef.get();

    if (!doseDoc.exists || doseDoc.data().circleId !== circleId) {
      return res.status(404).json({ success: false, error: 'Dose record not found in care circle.' });
    }

    const dose = doseDoc.data();
    const updates = {
      status: action,
      loggedAt: new Date().toISOString(),
      loggedBy: {
        uid: 'elder_one_click',
        name: 'Elder (Email Confirmation)',
        role: 'elder'
      },
      oneClickConfirmed: true,
      notes: 'Confirmed via one-click secure email link'
    };

    await doseRef.update(updates);
    const updatedDose = { ...dose, ...updates };

    await logCircleActivity({
      circleId,
      action: 'DOSE_CONFIRMED_ONE_CLICK',
      details: `Elder confirmed ${dose.medicineName} (${dose.scheduledTime}) as Taken via one-click email link`,
      actor: { uid: 'elder_one_click', name: 'Elder', role: 'elder' }
    });

    if (req.accepts('html') && req.method === 'GET') {
      return res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Dose Confirmed - CareCircle 360</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f0fdf4; padding: 24px; text-align: center; color: #1f2937; }
            .card { max-width: 520px; margin: 40px auto; background: white; padding: 40px; border-radius: 16px; box-shadow: 0 4px 16px rgba(0,0,0,0.06); border: 2px solid #16a34a; }
            .check-icon { font-size: 56px; color: #16a34a; margin-bottom: 12px; }
            h1 { color: #16a34a; font-size: 28px; margin: 0 0 12px 0; }
            .med-box { background: #f0fdf4; border-radius: 8px; padding: 16px; margin: 20px 0; border: 1px solid #bbf7d0; text-align: left; }
            p { font-size: 16px; line-height: 1.5; color: #4b5563; }
            .btn { display: inline-block; margin-top: 24px; padding: 14px 28px; background: #16a34a; color: white; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="check-icon">✓</div>
            <h1>Dose Confirmed Taken</h1>
            <p>Thank you! Your CareCircle has been updated.</p>
            <div class="med-box">
              <p style="margin: 4px 0; font-weight: bold; font-size: 18px; color: #15803d;">${dose.medicineName}</p>
              <p style="margin: 4px 0;">Scheduled for: <strong>${dose.scheduledDate} at ${dose.scheduledTime}</strong></p>
              <p style="margin: 4px 0; color: #15803d;">Status: <strong>Taken</strong></p>
            </div>
            <a href="/" class="btn">Go to Dashboard</a>
          </div>
        </body>
        </html>
      `);
    }

    return res.json({
      success: true,
      message: `Dose of ${dose.medicineName} successfully marked as ${action}.`,
      dose: updatedDose
    });
  } catch (err) {
    console.error('One click confirm error:', err);
    return res.status(500).json({ success: false, error: 'Failed to process dose confirmation.' });
  }
};

router.get('/one-click-confirm', handleOneClickConfirm);
router.post('/one-click-confirm', handleOneClickConfirm);

export default router;
