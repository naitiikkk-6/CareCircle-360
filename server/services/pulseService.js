import { getDb } from '../db.js';
import {
  generateDoseInstancesForCircle,
  getLocalDateInTimezone,
  getLocalTimeInTimezone
} from './doseService.js';

/**
 * Calculates the comprehensive Daily Care Pulse for the main dashboard.
 * - Today's doses with text status labels (never color alone)
 * - Completion indicator (e.g. "3 of 5 doses taken")
 * - Next upcoming dose
 * - Upcoming doctor appointments in order
 * - Active alerts (e.g. missed doses requiring attention)
 */
export async function calculateDailyCarePulse({ circle, targetDateStr = null, referenceDateObj = null }) {
  const db = getDb();
  const timezone = circle.timezone || 'Asia/Kolkata';
  const now = referenceDateObj || new Date();

  const currentDateStr = targetDateStr || getLocalDateInTimezone(now, timezone);
  const currentTimeStr = getLocalTimeInTimezone(now, timezone);

  // Synchronize doses for today and next 7 days
  await generateDoseInstancesForCircle(circle, 7);

  // 1. Fetch today's doses
  const dosesSnap = await db.collection('doseLogs')
    .where('circleId', '==', circle.id)
    .where('scheduledDate', '==', currentDateStr)
    .get();

  const todayDoses = [];
  dosesSnap.forEach(d => todayDoses.push(d.data()));

  // Sort by time ascending
  todayDoses.sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime));

  let takenCount = 0;
  let missedCount = 0;
  let pendingCount = 0;

  todayDoses.forEach(d => {
    if (d.status === 'Taken') takenCount++;
    else if (d.status === 'Missed') missedCount++;
    else pendingCount++;
  });

  const totalDosesToday = todayDoses.length;
  const evaluatedTotal = takenCount + missedCount;
  const adherenceRate = evaluatedTotal > 0
    ? Math.round((takenCount / evaluatedTotal) * 100)
    : (totalDosesToday > 0 ? 100 : 100);

  // Completion indicator text
  const completionText = totalDosesToday > 0
    ? `${takenCount} of ${totalDosesToday} doses taken (${Math.round((takenCount / totalDosesToday) * 100)}% complete)`
    : 'No medications scheduled for today';

  // 2. Determine next upcoming dose
  let nextUpcomingDose = null;
  const upcomingPending = todayDoses.filter(d => d.status === 'Pending' && d.scheduledTime >= currentTimeStr);

  if (upcomingPending.length > 0) {
    const next = upcomingPending[0];
    nextUpcomingDose = {
      id: next.id,
      medicineName: next.medicineName,
      strength: next.strength || next.dosage,
      scheduledTime: next.scheduledTime,
      instructions: next.instructions || '',
      textLabel: `Next: ${next.medicineName} (${next.strength || next.dosage}) at ${next.scheduledTime}`
    };
  } else if (pendingCount > 0) {
    // If pending doses exist but their scheduled time is earlier today
    const earliestPending = todayDoses.filter(d => d.status === 'Pending')[0];
    nextUpcomingDose = {
      id: earliestPending.id,
      medicineName: earliestPending.medicineName,
      strength: earliestPending.strength || earliestPending.dosage,
      scheduledTime: earliestPending.scheduledTime,
      instructions: earliestPending.instructions || '',
      textLabel: `Pending intake: ${earliestPending.medicineName} (${earliestPending.strength || earliestPending.dosage}) at ${earliestPending.scheduledTime}`
    };
  } else if (totalDosesToday > 0) {
    nextUpcomingDose = {
      completed: true,
      textLabel: 'All scheduled doses taken for today'
    };
  } else {
    nextUpcomingDose = {
      completed: true,
      textLabel: 'No medication scheduled for today'
    };
  }

  // 3. Fetch upcoming appointments (in order)
  const apptsSnap = await db.collection('appointments')
    .where('circleId', '==', circle.id)
    .get();

  const allAppts = [];
  apptsSnap.forEach(d => allAppts.push(d.data()));

  const upcomingAppts = allAppts
    .filter(a => a.status === 'Upcoming' && new Date(a.datetime).getTime() >= (now.getTime() - 2 * 60 * 60 * 1000))
    .sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime())
    .slice(0, 5); // top 5 upcoming

  // 4. Active alerts (text labels, never color alone)
  const activeAlerts = [];
  const missedToday = todayDoses.filter(d => d.status === 'Missed');

  if (missedToday.length > 0) {
    activeAlerts.push({
      type: 'missed-dose',
      level: 'warning',
      badgeText: '[ACTION REQUIRED: MISSED DOSE]',
      title: `${missedToday.length} Missed Dose${missedToday.length > 1 ? 's' : ''} Today`,
      message: `Missed: ${missedToday.map(m => `${m.medicineName} (${m.scheduledTime})`).join(', ')}. Please check in with ${circle.elderName || 'the elder'}.`
    });
  }

  // Appointment alert if any appointment is within 24 hours
  const soonAppts = upcomingAppts.filter(a => {
    const diffHours = (new Date(a.datetime).getTime() - now.getTime()) / (1000 * 60 * 60);
    return diffHours >= 0 && diffHours <= 24;
  });

  if (soonAppts.length > 0) {
    const first = soonAppts[0];
    const apptTime = new Date(first.datetime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    activeAlerts.push({
      type: 'appointment-soon',
      level: 'info',
      badgeText: '[UPCOMING APPOINTMENT WITHIN 24 HOURS]',
      title: `Doctor Visit Today/Tomorrow: Dr. ${first.doctorName}`,
      message: `${first.purpose} at ${first.place} (${apptTime}). Remember to bring medical files.`
    });
  }

  // Status text indicator with explicit text labels
  let statusTextBadge = '[EXCELLENT: ON TRACK]';
  let plainStatusMessage = 'All scheduled medications are on track.';
  if (missedCount > 0) {
    statusTextBadge = '[ATTENTION REQUIRED: MISSED DOSE]';
    plainStatusMessage = `${missedCount} dose was missed today. Follow up recommended.`;
  } else if (pendingCount > 0) {
    statusTextBadge = '[IN PROGRESS: DOSES REMAINING]';
    plainStatusMessage = `${pendingCount} dose remaining to be taken today.`;
  }

  return {
    circleId: circle.id,
    elderName: circle.elderName || 'Elder',
    date: currentDateStr,
    timezone,
    currentTime: currentTimeStr,
    totalDosesToday,
    takenCount,
    missedCount,
    pendingCount,
    adherenceRate,
    completionText,
    statusTextBadge,
    plainStatusMessage,
    nextUpcomingDose,
    upcomingAppointments: upcomingAppts,
    activeAlerts,
    doses: todayDoses
  };
}
