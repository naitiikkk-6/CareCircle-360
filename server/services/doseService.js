import { getDb } from '../db.js';
import { sendUpcomingDoseReminder, sendMissedDoseEscalation } from './emailService.js';

/**
 * Returns YYYY-MM-DD string for a Date in a specific IANA timezone.
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
  } catch (err) {
    return dateObj.toISOString().split('T')[0];
  }
}

/**
 * Returns HH:MM in a specific timezone.
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
  } catch (err) {
    const hours = String(dateObj.getUTCHours()).padStart(2, '0');
    const minutes = String(dateObj.getUTCMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }
}

/**
 * Returns day of week (0=Sunday, 1=Monday, ..., 6=Saturday) in a specific timezone.
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
  } catch (err) {
    return dateObj.getDay();
  }
}

/**
 * Generate and synchronize dose instances for a circle for the current day and the next N days (default 7 days).
 */
export async function generateDoseInstancesForCircle(circle, daysAhead = 7, referenceDate = null) {
  const db = getDb();
  const timezone = circle.timezone || 'Asia/Kolkata';

  const medsSnap = await db.collection('medications')
    .where('circleId', '==', circle.id)
    .get();

  const activeMeds = [];
  medsSnap.forEach(d => {
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
  const existingDosesSnap = await db.collection('doseLogs')
    .where('circleId', '==', circle.id)
    .where('scheduledDate', '>=', startDateStr)
    .where('scheduledDate', '<=', endDateStr)
    .get();

  const existingDoseIds = new Set();
  existingDosesSnap.forEach(d => existingDoseIds.add(d.id));

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

      const times = Array.isArray(med.times) && med.times.length > 0
        ? med.times
        : (Array.isArray(med.schedules) ? med.schedules.map(s => typeof s === 'string' ? s : s.time) : ['08:00']);

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
            status: 'Pending',
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
    dates: evaluatedDates.map(d => d.date)
  };
}

/**
 * Marks Pending doses as Missed after a configurable grace window (default 60 minutes).
 * CRITICAL RULE: Already Taken doses are NEVER modified!
 * Future doses remain Pending.
 */
export async function evaluateGraceWindowForMissedDoses({
  circle,
  graceWindowMinutes = 60,
  referenceDateObj = null
}) {
  const db = getDb();
  const timezone = circle.timezone || 'Asia/Kolkata';
  const now = referenceDateObj || new Date();

  const currentDateStr = getLocalDateInTimezone(now, timezone);
  const currentTimeStr = getLocalTimeInTimezone(now, timezone);

  // Fetch all doses for this circle
  const dosesSnap = await db.collection('doseLogs')
    .where('circleId', '==', circle.id)
    .get();

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
    if (dose.status === 'Taken') {
      results.skippedTakenCount++;
      continue;
    }

    // Already Missed
    if (dose.status === 'Missed') {
      continue;
    }

    // Only evaluate Pending doses
    if (dose.status === 'Pending') {
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
    status: 'Missed',
    missedReason: 'Auto-marked: Grace window expired without intake confirmation',
    escalationSent: true,
    loggedAt: new Date().toISOString(),
    loggedBy: {
      uid: 'system',
      name: 'CareCircle Automated Grace Window',
      role: 'system'
    }
  };

  await docRef.update ? docRef.update(updates) : db.collection('doseLogs').doc(dose.id).update(updates);

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
 * Calculates adherence for a date range.
 * Formula: taken / total due (where total due = taken + missed).
 * FUTURE DOSES ARE EXPLICITLY IGNORED.
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

  let dosesQuery = db.collection('doseLogs')
    .where('circleId', '==', circle.id);

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

  dosesSnap.forEach(d => {
    const dose = d.data();

    // Check date range filter
    if (startDate && dose.scheduledDate < startDate) return;
    if (endDate && dose.scheduledDate > endDate) return;

    if (dose.status === 'Taken') {
      takenCount++;
      takenDosesList.push(dose);
    } else if (dose.status === 'Missed') {
      missedCount++;
      missedDosesList.push(dose);
    } else if (dose.status === 'Pending') {
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
  const adherencePercentage = totalDue > 0
    ? Math.round((takenCount / totalDue) * 100)
    : 100;

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
    circle.members.forEach(m => {
      if (m.email) emails.add(m.email);
    });
  }
  return Array.from(emails);
}
