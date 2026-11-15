import { getDb } from '../db.js';
import {
  getLocalDateInTimezone,
  calculateAdherenceForRange
} from './doseService.js';
import { generateWeeklyFamilySummaryWithGemini } from './geminiService.js';
import { sendWeeklyFamilySummary } from './emailService.js';
import { logCircleActivity } from './activityService.js';

/**
 * Classifies an HH:MM time string into a plain time-of-day slot.
 * Morning: 05:00 - 11:59
 * Afternoon: 12:00 - 16:59
 * Evening: 17:00 - 20:59
 * Night: 21:00 - 04:59
 */
export function getTimeOfDaySlot(timeStr) {
  if (!timeStr || typeof timeStr !== 'string' || !timeStr.includes(':')) {
    return 'morning';
  }
  const [h] = timeStr.split(':').map(Number);
  if (h >= 5 && h < 12) return 'morning';
  if (h >= 12 && h < 17) return 'afternoon';
  if (h >= 17 && h < 21) return 'evening';
  return 'night';
}

/**
 * Aggregates 7-day adherence and missed doses by time of day for a care circle.
 *
 * @param {Object} circle
 * @param {Date|null} [referenceDateObj=null]
 * @returns {Promise<Object>}
 */
export async function computeWeeklySummaryData(circle, referenceDateObj = null) {
  const timezone = circle.timezone || 'Asia/Kolkata';
  const now = referenceDateObj ? new Date(referenceDateObj) : new Date();

  // Compute 7-day date window (today and the preceding 6 days)
  const endDateStr = getLocalDateInTimezone(now, timezone);
  const startDateObj = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
  const startDateStr = getLocalDateInTimezone(startDateObj, timezone);

  const adherenceData = await calculateAdherenceForRange({
    circle,
    startDate: startDateStr,
    endDate: endDateStr,
    referenceDateObj: now
  });

  // Aggregate missed doses by time of day slot
  const missedByTimeOfDay = {
    morning: 0,
    afternoon: 0,
    evening: 0,
    night: 0
  };

  const missedDoses = adherenceData.missedDoses || [];
  for (const dose of missedDoses) {
    const slot = getTimeOfDaySlot(dose.scheduledTime);
    missedByTimeOfDay[slot] = (missedByTimeOfDay[slot] || 0) + 1;
  }

  // Identify slot with highest missed count (if any)
  let mostMissedSlot = null;
  let maxMissed = 0;
  for (const [slot, count] of Object.entries(missedByTimeOfDay)) {
    if (count > maxMissed) {
      maxMissed = count;
      mostMissedSlot = slot;
    }
  }

  const elderFirstName = (circle.elderName || 'Elder').trim().split(' ')[0];

  // Generate 3 to 5 plain sentences using Gemini with safe template fallback
  const aiResult = await generateWeeklyFamilySummaryWithGemini({
    elderFirstName,
    adherenceRate: adherenceData.adherencePercentage,
    totalDue: adherenceData.totalDue,
    takenCount: adherenceData.takenCount,
    missedCount: adherenceData.missedCount,
    missedByTimeOfDay,
    mostMissedSlot
  });

  const weekRange = `${startDateStr} to ${endDateStr}`;

  return {
    circleId: circle.id,
    elderName: circle.elderName || 'Elder',
    elderFirstName,
    startDate: startDateStr,
    endDate: endDateStr,
    weekRange,
    adherenceRate: adherenceData.adherencePercentage,
    totalDue: adherenceData.totalDue,
    takenCount: adherenceData.takenCount,
    missedCount: adherenceData.missedCount,
    futurePendingCount: adherenceData.futurePendingCount,
    missedByTimeOfDay,
    mostMissedSlot,
    summaryText: aiResult.summaryText,
    generatedBy: aiResult.generatedBy,
    model: aiResult.model,
    generatedAt: now.toISOString()
  };
}

/**
 * Filter allowed recipients for weekly family digest based on elder-controlled settings.
 * Skips revoked members and respects member-level overrides.
 */
export function getWeeklySummaryRecipients(circle) {
  const emails = new Set();
  const perms = circle.permissions || {};

  // Elder always receives their own summary
  if (circle.elderEmail) {
    emails.add(circle.elderEmail);
  }

  const members = Array.isArray(circle.members) ? circle.members : [];

  for (const m of members) {
    if (!m.email || m.isRevoked) continue; // Revoked members never receive digests

    const mPerms = m.permissions || {};

    if (m.role === 'caretaker') {
      if (mPerms.alertWeeklySummary !== false && perms.caretakerCanReceiveWeeklySummary !== false) {
        emails.add(m.email);
      }
    } else if (m.role === 'family') {
      // Family members receive digest if permitted by elder
      if (mPerms.alertWeeklySummary !== false && perms.familyCanReceiveWeeklySummary !== false) {
        emails.add(m.email);
      }
    }
  }

  return Array.from(emails);
}

/**
 * Compute, cache, and optionally email the weekly summary for a circle.
 */
export async function processWeeklySummaryForCircle({
  circle,
  referenceDateObj = null,
  sendEmail = false,
  forceSend = false
}) {
  const db = getDb();
  const now = referenceDateObj ? new Date(referenceDateObj) : new Date();
  const summary = await computeWeeklySummaryData(circle, now);

  // Compute a stable week identifier like circleId_YYYY-Wxx
  const weekYear = `${summary.endDate.substring(0, 4)}-W${Math.ceil(new Date(summary.endDate).getDate() / 7)}`;
  const summaryDocId = `summary_${circle.id}_${summary.endDate}`;

  let emailsSent = 0;
  const recipients = getWeeklySummaryRecipients(circle);

  if (sendEmail) {
    // Check duplicate prevention: has this circle already sent a summary for this week?
    const existingSummaryDoc = await db.collection('weeklySummaries').doc(summaryDocId).get();
    const alreadySentThisWeek = existingSummaryDoc.exists && existingSummaryDoc.data().emailSentAt;

    if (!alreadySentThisWeek || forceSend) {
      for (const email of recipients) {
        await sendWeeklyFamilySummary({
          to: email,
          elderName: circle.elderName || 'Elder',
          weekRange: summary.weekRange,
          adherenceRate: summary.adherenceRate,
          summaryText: summary.summaryText
        });
        emailsSent++;
      }

      summary.emailSentAt = now.toISOString();
      summary.sentRecipients = recipients;

      await logCircleActivity({
        circleId: circle.id,
        action: 'WEEKLY_SUMMARY_SENT',
        details: `Weekly digest sent to ${recipients.length} allowed recipients (${summary.adherenceRate}% adherence)`,
        actor: { uid: 'system_scheduler', name: 'Weekly Scheduler', role: 'system' }
      });
    }
  }

  // Persist summary in Firestore / DB
  await db.collection('weeklySummaries').doc(summaryDocId).set(summary);

  return {
    ...summary,
    emailsSent,
    recipients
  };
}
