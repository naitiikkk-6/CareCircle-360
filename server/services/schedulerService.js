import { getDb } from '../db.js';
import { config } from '../config.js';
import {
  generateDoseInstancesForCircle,
  getLocalDateInTimezone,
  getLocalTimeInTimezone
} from './doseService.js';
import {
  sendUpcomingDoseReminder,
  sendMissedDoseEscalation,
  sendAppointmentReminder,
  sendDailyPulseSummary,
  sendWeeklyFamilySummary
} from './emailService.js';
import { generateOneClickToken } from './tokenService.js';
import { processWeeklySummaryForCircle } from './weeklySummaryService.js';

/**
 * Filter circle recipients based on the elder's sharing & alert permissions.
 *
 * @param {Object} circle
 * @param {'upcoming-dose'|'missed-dose'|'appointment'} alertType
 * @returns {string[]} List of unique email addresses allowed to receive the alert
 */
export function getRecipientsForAlertType(circle, alertType) {
  const emails = new Set();
  const perms = circle.permissions || {};

  // The Elder is always notified regarding their own healthcare
  if (circle.elderEmail) {
    emails.add(circle.elderEmail);
  }

  const members = Array.isArray(circle.members) ? circle.members : [];

  for (const m of members) {
    if (!m.email || m.isRevoked) continue;

    const mPerms = m.permissions || {};

    if (alertType === 'upcoming-dose') {
      // Caretaker gets upcoming reminders if permitted
      if (m.role === 'caretaker' && mPerms.alertIntakeReminders !== false && perms.caretakerCanReceiveReminders !== false) {
        emails.add(m.email);
      }
      // Family only receives upcoming intake reminders if specifically enabled
      else if (m.role === 'family' && (mPerms.alertIntakeReminders === true || perms.familyCanReceiveReminders === true)) {
        emails.add(m.email);
      }
    } else if (alertType === 'missed-dose') {
      // Missed doses are safety escalations
      if (m.role === 'caretaker' && mPerms.alertMissedDoses !== false && perms.caretakerCanReceiveMissedAlerts !== false) {
        emails.add(m.email);
      } else if (m.role === 'family' && mPerms.alertMissedDoses !== false && perms.familyCanReceiveMissedAlerts !== false) {
        emails.add(m.email);
      }
    } else if (alertType === 'appointment') {
      if (m.role === 'caretaker' && mPerms.alertAppointments !== false && perms.caretakerCanReceiveApptReminders !== false) {
        emails.add(m.email);
      } else if (m.role === 'family' && mPerms.alertAppointments !== false && perms.familyCanReceiveApptReminders !== false) {
        emails.add(m.email);
      }
    }
  }

  return Array.from(emails);
}

/**
 * Main routine for Cloud Scheduler cron job (called e.g. every 5 minutes).
 * Performs:
 * (a) Email about doses due within the next 15 minutes
 * (b) Mark overdue doses as Missed and email about them
 * (c) Email about appointments in the next 24 hours
 *
 * Prevents duplicate emails by updating and checking reminderSent/missedAlertSent flags.
 *
 * @param {Object} options
 * @param {string|null} [options.circleId] - Optional specific circle ID filter
 * @param {Date|null} [options.referenceDateObj] - Optional time override for deterministic testing
 * @returns {Promise<Object>} Execution summary
 */
export async function runCronReminders({
  circleId = null,
  referenceDateObj = null,
  includeWeeklySummary = false,
  forceWeeklySummary = false
} = {}) {
  const db = getDb();
  const now = referenceDateObj ? new Date(referenceDateObj) : new Date();

  const summary = {
    processedCircles: 0,
    upcomingRemindersSent: 0,
    missedDosesMarked: 0,
    missedAlertsSent: 0,
    appointmentRemindersSent: 0,
    weeklySummariesSent: 0,
    timestamp: now.toISOString()
  };

  let circles = [];
  if (circleId) {
    const singleDoc = await db.collection('careCircles').doc(circleId).get();
    if (singleDoc.exists) circles.push(singleDoc.data());
  } else {
    const snap = await db.collection('careCircles').get();
    snap.forEach(d => circles.push(d.data()));
  }

  for (const circle of circles) {
    summary.processedCircles++;
    const elderName = circle.elderName || 'Elder';
    const timezone = circle.timezone || 'Asia/Kolkata';
    const graceMinutes = circle.graceWindowMinutes || 60;

    // Synchronize today and next 7 days of doses
    await generateDoseInstancesForCircle(circle, 7, now);

    const currentDateStr = getLocalDateInTimezone(now, timezone);
    const currentTimeStr = getLocalTimeInTimezone(now, timezone);
    const [currH, currM] = currentTimeStr.split(':').map(Number);
    const currTotalMinutes = currH * 60 + currM;

    // Fetch all doseLogs for this circle
    const dosesSnap = await db.collection('doseLogs')
      .where('circleId', '==', circle.id)
      .get();

    for (const doseDoc of dosesSnap.docs) {
      const dose = doseDoc.data();

      // (a) Upcoming dose reminder: due within next 15 minutes
      if (dose.status === 'Pending' && dose.scheduledDate === currentDateStr && !dose.reminderSent) {
        const [schedH, schedM] = dose.scheduledTime.split(':').map(Number);
        const schedTotalMinutes = schedH * 60 + schedM;
        const diffMinutes = schedTotalMinutes - currTotalMinutes;

        // Due within [0, 15] minutes from now
        if (diffMinutes >= 0 && diffMinutes <= 15) {
          const recipients = getRecipientsForAlertType(circle, 'upcoming-dose');
          for (const email of recipients) {
            await sendUpcomingDoseReminder({
              to: email,
              elderName,
              medicineName: dose.medicineName,
              strength: dose.strength || dose.dosage,
              scheduledTime: dose.scheduledTime,
              instructions: dose.instructions
            });
          }

          // Prevent duplicate emails
          await db.collection('doseLogs').doc(dose.id).update({
            reminderSent: true,
            reminderSentAt: now.toISOString()
          });

          summary.upcomingRemindersSent++;
        }
      }

      // (b) Overdue doses: mark as Missed and execute 3-tier escalation
      // Tier 1: First reminder to Elder with signed one-click confirmation link
      // Tier 2: After configurable delay (default 15m), alert primary Caretakers
      // Tier 3: After configurable delay (default 30m), alert Family
      let isOverdue = false;
      let minutesOverdue = 0;

      if (dose.status === 'Pending' || dose.status === 'Missed') {
        if (dose.scheduledDate < currentDateStr) {
          isOverdue = true;
          minutesOverdue = 1440; // past day
        } else if (dose.scheduledDate === currentDateStr) {
          const [schedH, schedM] = dose.scheduledTime.split(':').map(Number);
          const schedTotalMinutes = schedH * 60 + schedM;
          const diffMinutes = schedTotalMinutes - currTotalMinutes;

          // If current time is past scheduled time by more than grace period (diffMinutes < -graceMinutes)
          if (diffMinutes < -graceMinutes) {
            isOverdue = true;
            minutesOverdue = Math.abs(diffMinutes) - graceMinutes;
          }
        }
      }

      if (isOverdue && dose.status !== 'Taken') {
        const updates = {};

        if (dose.status === 'Pending') {
          updates.status = 'Missed';
          updates.missedReason = `Overdue: ${graceMinutes} min grace window elapsed without confirmation`;
          updates.missedAt = now.toISOString();
          summary.missedDosesMarked++;
        }

        const caretakerDelayMins = circle.caretakerEscalationDelayMinutes ?? 15;
        const familyDelayMins = circle.familyEscalationDelayMinutes ?? 30;

        // Tier 1: Immediate reminder to the Elder with one-click signed confirmation link
        if (!dose.tier1SentAt && !dose.missedAlertSent) {
          const token = generateOneClickToken({
            doseId: dose.id,
            circleId: circle.id,
            action: 'Taken',
            expiresInHours: 24
          });
          const baseUrl = config.baseUrl || 'http://localhost:3000';
          const confirmUrl = `${baseUrl}/api/doses/one-click-confirm?token=${encodeURIComponent(token)}`;

          if (circle.elderEmail) {
            await sendMissedDoseEscalation({
              to: circle.elderEmail,
              elderName,
              medicineName: dose.medicineName,
              strength: dose.strength || dose.dosage,
              scheduledTime: dose.scheduledTime,
              circleName: circle.name,
              confirmUrl,
              tier: 1
            });
          }

          updates.tier1SentAt = now.toISOString();
          updates.escalationTier = 1;
          updates.missedAlertSent = true;
          updates.escalationSent = true; // backward compatibility
          updates.missedAlertSentAt = now.toISOString();
          updates.oneClickToken = token;
          summary.missedAlertsSent++;
        }

        const effectiveTier1Time = dose.tier1SentAt ? new Date(dose.tier1SentAt).getTime() : now.getTime();
        const minsSinceTier1 = (now.getTime() - effectiveTier1Time) / (60 * 1000);

        // Tier 2: Escalation to Caretakers after delay
        if ((updates.tier1SentAt || dose.tier1SentAt) && !dose.tier2SentAt) {
          if (minsSinceTier1 >= caretakerDelayMins || minutesOverdue >= caretakerDelayMins) {
            const caretakerRecipients = (circle.members || [])
              .filter(m => !m.isRevoked && m.role === 'caretaker' && m.permissions?.alertMissedDoses !== false && circle.permissions?.caretakerCanReceiveMissedAlerts !== false)
              .map(m => m.email)
              .filter(Boolean);

            for (const email of caretakerRecipients) {
              await sendMissedDoseEscalation({
                to: email,
                elderName,
                medicineName: dose.medicineName,
                strength: dose.strength || dose.dosage,
                scheduledTime: dose.scheduledTime,
                circleName: circle.name,
                confirmUrl: null,
                tier: 2
              });
            }

            updates.tier2SentAt = now.toISOString();
            updates.escalationTier = 2;
            if (caretakerRecipients.length > 0) summary.missedAlertsSent++;
          }
        }

        // Tier 3: Escalation to Family after further delay
        if ((updates.tier2SentAt || dose.tier2SentAt) && !dose.tier3SentAt) {
          if (minsSinceTier1 >= familyDelayMins || minutesOverdue >= familyDelayMins) {
            const familyRecipients = (circle.members || [])
              .filter(m => !m.isRevoked && m.role === 'family' && m.permissions?.alertMissedDoses !== false && circle.permissions?.familyCanReceiveMissedAlerts !== false)
              .map(m => m.email)
              .filter(Boolean);

            for (const email of familyRecipients) {
              await sendMissedDoseEscalation({
                to: email,
                elderName,
                medicineName: dose.medicineName,
                strength: dose.strength || dose.dosage,
                scheduledTime: dose.scheduledTime,
                circleName: circle.name,
                confirmUrl: null,
                tier: 3
              });
            }

            updates.tier3SentAt = now.toISOString();
            updates.escalationTier = 3;
            if (familyRecipients.length > 0) summary.missedAlertsSent++;
          }
        }

        if (Object.keys(updates).length > 0) {
          await db.collection('doseLogs').doc(dose.id).update(updates);
        }
      }
    }

    // (c) Upcoming doctor appointments in the next 24 hours
    const apptsSnap = await db.collection('appointments')
      .where('circleId', '==', circle.id)
      .get();

    for (const apptDoc of apptsSnap.docs) {
      const appt = apptDoc.data();
      if (appt.status !== 'Upcoming' || appt.reminderSent) continue;

      const apptDate = new Date(appt.datetime);
      if (isNaN(apptDate.getTime())) continue;

      const diffMs = apptDate.getTime() - now.getTime();
      const diffHours = diffMs / (1000 * 60 * 60);

      // Between 0 and 24 hours
      if (diffHours > 0 && diffHours <= 24) {
        const recipients = getRecipientsForAlertType(circle, 'appointment');
        const formattedTime = apptDate.toLocaleDateString('en-IN', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });

        for (const email of recipients) {
          await sendAppointmentReminder({
            to: email,
            elderName,
            doctorName: appt.doctorName,
            purpose: appt.purpose || appt.specialty,
            appointmentTime: formattedTime,
            place: appt.place || appt.location
          });
        }

        // Prevent duplicate emails
        await db.collection('appointments').doc(appt.id).update({
          reminderSent: true,
          reminderSentAt: now.toISOString()
        });

        summary.appointmentRemindersSent++;
      }
    }

    // (d) Weekly Family Care Summary (once a week, when triggered by scheduler)
    // Dispatched to circle members the elder has allowed
    if (includeWeeklySummary || forceWeeklySummary) {
      try {
        const weeklyResult = await processWeeklySummaryForCircle({
          circle,
          referenceDateObj: now,
          sendEmail: true,
          forceSend: Boolean(forceWeeklySummary)
        });
        summary.weeklySummariesSent += (weeklyResult.emailsSent || 0);
      } catch (err) {
        console.error(`Weekly summary dispatch error for circle ${circle.id}:`, err);
      }
    }
  }

  return summary;
}

// Backward-compatible alias for existing test suites
export async function runSchedulerCycle(options = {}) {
  const cronRes = await runCronReminders(options);
  return {
    ...cronRes,
    missedEscalationsSent: cronRes.missedAlertsSent
  };
}

/**
 * Triggers Daily Care Pulse calculations and emails for a circle.
 */
export async function generateDailyCarePulse(circleId, targetDateStr = null) {
  const db = getDb();
  const circleDoc = await db.collection('careCircles').doc(circleId).get();
  if (!circleDoc.exists) throw new Error('Care circle not found');

  const circle = circleDoc.data();
  const timezone = circle.timezone || 'Asia/Kolkata';
  const date = targetDateStr || getLocalDateInTimezone(new Date(), timezone);

  const dosesSnap = await db.collection('doseLogs')
    .where('circleId', '==', circleId)
    .where('scheduledDate', '==', date)
    .get();

  let taken = 0;
  let missed = 0;
  let pending = 0;

  dosesSnap.forEach(d => {
    const data = d.data();
    if (data.status === 'Taken') taken++;
    else if (data.status === 'Missed') missed++;
    else pending++;
  });

  const total = taken + missed + pending;
  const adherence = (taken + missed) > 0 ? Math.round((taken / (taken + missed)) * 100) : 100;

  const pulseRecord = {
    circleId,
    date,
    totalDoses: total,
    taken,
    missed,
    pending,
    adherencePercentage: adherence,
    generatedAt: new Date().toISOString()
  };

  await db.collection('carePulse').doc(`${circleId}_${date}`).set(pulseRecord);

  // Send daily pulse email to elder and permitted members
  const recipientEmails = getRecipientsForAlertType(circle, 'upcoming-dose');
  for (const email of recipientEmails) {
    await sendDailyPulseSummary({
      to: email,
      elderName: circle.elderName || 'Elder',
      date,
      adherencePercentage: adherence,
      dosesTaken: taken,
      dosesMissed: missed,
      totalDoses: total
    });
  }

  return pulseRecord;
}
