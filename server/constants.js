/**
 * CareCircle 360 - Application Constants
 * Single source of truth for user roles, dose statuses, and scheduling time windows.
 */

export const ROLES = Object.freeze({
  ELDER: 'elder',
  CARETAKER: 'caretaker',
  FAMILY: 'family'
});

export const ALL_ROLES = Object.freeze([ROLES.ELDER, ROLES.CARETAKER, ROLES.FAMILY]);

export const DOSE_STATUS = Object.freeze({
  PENDING: 'Pending',
  TAKEN: 'Taken',
  MISSED: 'Missed'
});

export const ALL_DOSE_STATUSES = Object.freeze([
  DOSE_STATUS.PENDING,
  DOSE_STATUS.TAKEN,
  DOSE_STATUS.MISSED
]);

export const GRACE_WINDOW_MINUTES = 60;
export const DUE_SOON_MINUTES = 15;
export const APPOINTMENT_REMINDER_HOURS = 24;

export const TIME_WINDOWS = Object.freeze({
  UPCOMING_DOSE_ALERT_MINUTES: DUE_SOON_MINUTES,
  DEFAULT_GRACE_WINDOW_MINUTES: GRACE_WINDOW_MINUTES,
  DEFAULT_CARETAKER_ESCALATION_MINUTES: 15,
  DEFAULT_FAMILY_ESCALATION_MINUTES: 30,
  APPOINTMENT_ALERT_HOURS: APPOINTMENT_REMINDER_HOURS,
  ONE_CLICK_TOKEN_EXPIRY_HOURS: 24,
  DOSES_AHEAD_DAYS: 7
});

export const TIME_OF_DAY_SLOTS = Object.freeze({
  MORNING: 'morning',
  AFTERNOON: 'afternoon',
  EVENING: 'evening',
  NIGHT: 'night'
});

