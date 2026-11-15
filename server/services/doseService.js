import { getDb } from '../db.js';
import { sendMissedDoseEscalation } from './emailService.js';
import { DOSE_STATUS, GRACE_WINDOW_MINUTES, TIME_WINDOWS } from '../constants.js';

/**
 * Formats a Date object into a YYYY-MM-DD string in the specified IANA timezone.
 *
 * @param {Date} dateObj - The Date object to format.
 * @param {string} [timezone='Asia/Kolkata'] - IANA timezone identifier.
 * @returns {string} Formatted local date string (e.g. "2026-11-15").
 */
export function getLocalDateInTimezone(dateObj, timezone = 'Asia/Kolkata') {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    return formatter.format(dateObj); // e.g. "2026-11-15"
  } catch (_err) {
    return dateObj.toISOString().split('T')[0];
  }
}

/**
 * Formats a Date object into a 24-hour HH:MM string in the specified IANA timezone.
 *
 * @param {Date} dateObj - The Date object to format.
 * @param {string} [timezone='Asia/Kolkata'] - IANA timezone identifier.
 * @returns {string} Formatted time string in 24-hour format (e.g. "14:30").
 */
export function getLocalTimeInTimezone(dateObj, timezone = 'Asia/Kolkata') {
  try {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    return formatter.format(dateObj); // "14:30"
  } catch (_err) {
    const hours = String(dateObj.getUTCHours()).padStart(2, '0');
    const minutes = String(dateObj.getUTCMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }
}

/**
 * Returns the day of the week (0=Sunday, 1=Monday, ..., 6=Saturday) in the specified timezone.
 *
 * @param {Date} dateObj - The Date object to evaluate.
 * @param {string} [timezone='Asia/Kolkata'] - IANA timezone identifier.
 * @returns {number} Integer representing day of week (0 to 6).
 */
export function getLocalDayOfWeekInTimezone(dateObj, timezone = 'Asia/Kolkata') {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short'
    });
    const shortName = formatter.format(dateObj).toLowerCase();
    const dayMap = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
    return dayMap[shortName] ?? dateObj.getDay();
  } catch (_err) {
    return dateObj.getDay();
  }
}

/**
 * Generates and synchronizes dose instances for a care circle across a forward-looking window.
 *
 * @param {Object} circle - Care circle document containing ID, timezone, and settings.
 * @param {number} [daysAhead=7] - Number of future days to generate doses for.
 * @param {Date|null} [referenceDate=null] - Optional reference date override for simulation/testing.
 * @returns {Promise<{ generatedCount: number, totalDaysEvaluated: number, dates: string[] }>}
 */
export async function generateDoseInstancesForCircle(
  circle,
  daysAhead = TIME_WINDOWS.DOSES_AHEAD_DAYS,
  referenceDate = null
) {
  const db = getDb();
  const timezone = circle.timezone || 'Asia/Kolkata';

  const medsSnap = await db.collection('medications').where('circleId', '==', circle.id).get();

  const activeMeds = [];
  medsSnap.forEach((d) => {
    const m = d.data();
    if (m.active !== false) activeMeds.push(m);
  });

  if (activeMeds.length === 0) {
    return { generatedCount: 0, totalDaysEvaluated: daysAhead + 1, dates: [] };
  }

  const generatedDoses = [];
  const evaluatedDates = [];
  const now = referenceDate ? new Date(referenceDate) : new Date();

  // Compute start and end dates for a single range query
  const startDateStr = getLocalDateInTimezone(now, timezone);
  const maxDateObj = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
  const endDateStr = getLocalDateInTimezone(maxDateObj, timezone);

  // Single range query for the circle's doses across the evaluated window
  const existingDosesSnap = await db
    .collection('doseLogs')
    .where('circleId', '==', circle.id)
    .where('scheduledDate', '>=', startDateStr)
    .where('scheduledDate', '<=', endDateStr)
    .get();

  const existingDoseIds = new Set();
  existingDosesSnap.forEach((d) => existingDoseIds.add(d.id));

  for (let offset = 0; offset <= daysAhead; offset++) {
    const targetDateObj = new Date(now.getTime() + offset * 24 * 60 * 60 * 1000);
    const dateStr = getLocalDateInTimezone(targetDateObj, timezone);
    const dayOfWeek = getLocalDayOfWeekInTimezone(targetDateObj, timezone);

    evaluatedDates.push({ date: dateStr, dayOfWeek, offset });

    for (const med of activeMeds) {
      if (dateStr < med.startDate) continue;
      if (med.endDate && dateStr > med.endDate) continue;

      let isScheduledForDay = false;
      if (med.frequencyType === 'daily' || !med.frequencyType) {
        isScheduledForDay = true;
      } else if (med.frequencyType === 'weekdays') {
        const allowedDays = Array.isArray(med.daysOfWeek) ? med.daysOfWeek : [];
        isScheduledForDay = allowedDays.includes(dayOfWeek);
      }

      if (!isScheduledForDay) continue;

      const times =
        Array.isArray(med.times) && med.times.length > 0
          ? med.times
          : Array.isArray(med.schedules)
            ? med.schedules.map((s) => (typeof s === 'string' ? s : s.time))
            : ['08:00'];

      for (const timeStr of times) {
        if (!timeStr) continue;
        const doseKey = `${circle.id}_${med.id}_${dateStr}_${timeStr}`;

        // In-memory check using Set instead of per-iteration doseRef.get()
        if (!existingDoseIds.has(doseKey)) {
          const doseRef = db.collection('doseLogs').doc(doseKey);
          const newDose = {
            id: doseKey,
            circleId: circle.id,
            medicationId: med.id,
            medicineName: med.name,
            strength: med.strength || med.dosage,
            dosage: med.strength || med.dosage,
            form: med.form || 'Tablet',
            instructions: med.instructions || med.packagingInstructions || '',
            instructionsType: 'user-entered',
            sourceLabel: med.sourceLabel || 'Not verified - ask your pharmacist or doctor',
            scheduledDate: dateStr,
            scheduledTime: timeStr,
            timezone,
            status: DOSE_STATUS.PENDING,
            reminderSent: false,
            escalationSent: false,
            createdAt: new Date().toISOString()
          };

          await doseRef.set(newDose);
          existingDoseIds.add(doseKey);
          generatedDoses.push(newDose);
        }
      }
    }
  }

  return {
    generatedCount: generatedDoses.length,
    totalDaysEvaluated: evaluatedDates.length,
    dates: evaluatedDates.map((d) => d.date)
  };
}

/**
 * Evaluates pending doses against a circle's grace period and transitions overdue doses to Missed.
 * Enforces critical safety invariants: already Taken doses are never modified.
 *
 * @param {Object} options
 * @param {Object} options.circle - Care circle document.
 * @param {number} [options.graceWindowMinutes=60] - Number of minutes after scheduled time before marking Missed.
 * @param {Date|null} [options.referenceDateObj=null] - Date object for time calculation/testing.
 * @returns {Promise<{ evaluatedCount: number, markedMissedCount: number, skippedTakenCount: number, futurePendingCount: number, missedDoses: string[] }>}
 */
export async function evaluateGraceWindowForMissedDoses({
  circle,
  graceWindowMinutes = GRACE_WINDOW_MINUTES,
  referenceDateObj = null
}) {
  const db = getDb();
  const timezone = circle.timezone || 'Asia/Kolkata';
  const now = referenceDateObj || new Date();

  const currentDateStr = getLocalDateInTimezone(now, timezone);
  const currentTimeStr = getLocalTimeInTimezone(now, timezone);

  // Fetch all doses for this circle
  const dosesSnap = await db.collection('doseLogs').where('circleId', '==', circle.id).get();

  const results = {
    evaluatedCount: 0,
    markedMissedCount: 0,
    skippedTakenCount: 0,
    futurePendingCount: 0,
    missedDoses: []
  };

  const currentTotalMinutes = parseTimeToMinutes(currentTimeStr);

  for (const doc of dosesSnap.docs) {
    const dose = doc.data();
    results.evaluatedCount++;

    // Safety rule: Never turn a Taken dose into Missed!
    if (dose.status === DOSE_STATUS.TAKEN) {
      results.skippedTakenCount++;
      continue;
    }

    // Already Missed
    if (dose.status === DOSE_STATUS.MISSED) {
      continue;
    }

    // Only evaluate Pending doses
    if (dose.status === DOSE_STATUS.PENDING) {
      const isPastDate = dose.scheduledDate < currentDateStr;
      const isFutureDate = dose.scheduledDate > currentDateStr;

      if (isFutureDate) {
        results.futurePendingCount++;
        continue;
      }

      if (isPastDate) {
        // From an earlier day: grace window definitely expired
        await markDoseAsMissed(db, doc, dose, circle);
        results.markedMissedCount++;
        results.missedDoses.push(dose.id);
        continue;
      }

      // Same day: evaluate time difference
      const scheduledMinutes = parseTimeToMinutes(dose.scheduledTime);
      const minutesOverdue = currentTotalMinutes - scheduledMinutes;

      if (minutesOverdue > graceWindowMinutes) {
        // Exceeded grace window -> mark as Missed
        await markDoseAsMissed(db, doc, dose, circle);
        results.markedMissedCount++;
        results.missedDoses.push(dose.id);
      } else {
        // Within grace window or upcoming -> remains Pending
        results.futurePendingCount++;
      }
    }
  }

  return results;
}

async function markDoseAsMissed(db, docRef, dose, circle) {
  const updates = {
    status: DOSE_STATUS.MISSED,
    missedReason: 'Auto-marked: Grace window expired without intake confirmation',
    escalationSent: true,
    loggedAt: new Date().toISOString(),
    loggedBy: {
      uid: 'system',
      name: 'CareCircle Automated Grace Window',
      role: 'system'
    }
  };

  (await docRef.update)
    ? docRef.update(updates)
    : db.collection('doseLogs').doc(dose.id).update(updates);

  // Trigger escalation email if recipients available
  const recipients = getCircleAlertRecipients(circle);
  for (const email of recipients) {
    await sendMissedDoseEscalation({
      to: email,
      elderName: circle.elderName || 'Elder',
      medicineName: dose.medicineName,
      scheduledTime: `${dose.scheduledDate} ${dose.scheduledTime}`,
      circleName: circle.name
    });
  }
}

/**
 * Calculates adherence percentage and categorizes doses for a given date window.
 * Strictly adheres to formula: taken / (taken + missed). Future scheduled doses are ignored.
 *
 * @param {Object} options
 * @param {Object} options.circle - Care circle document.
 * @param {string} options.startDate - Start of evaluation range (YYYY-MM-DD).
 * @param {string} options.endDate - End of evaluation range (YYYY-MM-DD).
 * @param {Date|null} [options.referenceDateObj=null] - Date object for time evaluation/testing.
 * @returns {Promise<{ adherencePercentage: number, takenCount: number, missedCount: number, futurePendingCount: number, totalDue: number, missedDoses: Object[], takenDoses: Object[] }>}
 */
export async function calculateAdherenceForRange({
  circle,
  startDate,
  endDate,
  referenceDateObj = null
}) {
  const db = getDb();
  const timezone = circle.timezone || 'Asia/Kolkata';
  const now = referenceDateObj || new Date();
  const currentDateStr = getLocalDateInTimezone(now, timezone);
  const currentTimeStr = getLocalTimeInTimezone(now, timezone);
  const currentTotalMinutes = parseTimeToMinutes(currentTimeStr);

  let dosesQuery = db.collection('doseLogs').where('circleId', '==', circle.id);

  if (startDate) {
    dosesQuery = dosesQuery.where('scheduledDate', '>=', startDate);
  }
  if (endDate) {
    dosesQuery = dosesQuery.where('scheduledDate', '<=', endDate);
  }

  const dosesSnap = await dosesQuery.get();

  let takenCount = 0;
  let missedCount = 0;
  let futurePendingCount = 0;
  const missedDosesList = [];
  const takenDosesList = [];

  dosesSnap.forEach((d) => {
    const dose = d.data();

    // Check date range filter
    if (startDate && dose.scheduledDate < startDate) return;
    if (endDate && dose.scheduledDate > endDate) return;

    if (dose.status === DOSE_STATUS.TAKEN) {
      takenCount++;
      takenDosesList.push(dose);
    } else if (dose.status === DOSE_STATUS.MISSED) {
      missedCount++;
      missedDosesList.push(dose);
    } else if (dose.status === DOSE_STATUS.PENDING) {
      // Check if this pending dose is in the future or already overdue
      const isPastDate = dose.scheduledDate < currentDateStr;
      const isFutureDate = dose.scheduledDate > currentDateStr;

      if (isFutureDate) {
        futurePendingCount++;
      } else if (isPastDate) {
        // Overdue from a past day -> counts as missed
        missedCount++;
        missedDosesList.push(dose);
      } else {
        // Today: check scheduled time
        const scheduledMinutes = parseTimeToMinutes(dose.scheduledTime);
        if (scheduledMinutes > currentTotalMinutes) {
          // Future dose scheduled for later today -> ignore from due count
          futurePendingCount++;
        } else {
          // Past its scheduled time today but still pending -> counts as overdue/missed in adherence
          missedCount++;
          missedDosesList.push(dose);
        }
      }
    }
  });

  const totalDue = takenCount + missedCount;
  const adherencePercentage = totalDue > 0 ? Math.round((takenCount / totalDue) * 100) : 100;

  // Sort missed doses by date descending
  missedDosesList.sort((a, b) => {
    if (a.scheduledDate !== b.scheduledDate) return b.scheduledDate.localeCompare(a.scheduledDate);
    return b.scheduledTime.localeCompare(a.scheduledTime);
  });

  return {
    circleId: circle.id,
    startDate,
    endDate,
    adherencePercentage,
    totalDue,
    takenCount,
    missedCount,
    futurePendingCount,
    missedDoses: missedDosesList
  };
}

function parseTimeToMinutes(timeStr) {
  if (!timeStr || !timeStr.includes(':')) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function getCircleAlertRecipients(circle) {
  const emails = new Set();
  if (circle.elderEmail) emails.add(circle.elderEmail);
  if (Array.isArray(circle.members)) {
    circle.members.forEach((m) => {
      if (m.email) emails.add(m.email);
    });
  }
  return Array.from(emails);
}
