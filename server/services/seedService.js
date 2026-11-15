import bcrypt from 'bcryptjs';
import { getDb } from '../db.js';
import { getLocalDateInTimezone } from './doseService.js';
import { ROLES, DOSE_STATUS } from '../constants.js';

export const DEMO_CIRCLE_ID = 'circle_demo_sharma_360';
export const DEMO_PASSCODE = 'demoPass123';

export const DEMO_USERS = {
  elder: {
    uid: 'demo_elder_ramesh',
    name: 'Ramesh Sharma (Elder)',
    email: 'ramesh.elder@carecircle.demo',
    role: ROLES.ELDER
  },
  caretaker: {
    uid: 'demo_caretaker_sunita',
    name: 'Sunita Verma (Caretaker)',
    email: 'sunita.care@carecircle.demo',
    role: ROLES.CARETAKER
  },
  family: {
    uid: 'demo_family_arun',
    name: 'Arun Sharma (Son / Family)',
    email: 'arun.family@carecircle.demo',
    role: ROLES.FAMILY
  }
};

/**
 * Seeds a fake care circle with elder, caretaker, and family member.
 * All demo records are clearly labelled as simulated demo data (no real patient data).
 *
 * @returns {Promise<{ success: boolean, circleId: string, elder: Object, caretaker: Object, family: Object }>}
 */
export async function seedDemoCareCircle() {
  const db = getDb();
  const circleRef = db.collection('careCircles').doc(DEMO_CIRCLE_ID);
  const passcodeHash = await bcrypt.hash(DEMO_PASSCODE, 10);
  const now = new Date();
  const todayStr = getLocalDateInTimezone(now, 'Asia/Kolkata');

  // Seed / update users
  const userPasswordHash = await bcrypt.hash('demoPass123', 10);
  for (const persona of Object.values(DEMO_USERS)) {
    await db.collection('users').doc(persona.uid).set(
      {
        uid: persona.uid,
        name: persona.name,
        email: persona.email,
        passwordHash: userPasswordHash,
        defaultRole: persona.role,
        isDemo: true,
        updatedAt: now.toISOString()
      },
      { merge: true }
    );
  }

  // 1. Seed Care Circle
  const demoCircleData = {
    id: DEMO_CIRCLE_ID,
    name: 'Sharma Family Care Circle [DEMO DATA]',
    elderName: 'Ramesh Sharma [DEMO]',
    elderUid: DEMO_USERS.elder.uid,
    elderEmail: DEMO_USERS.elder.email,
    timezone: 'Asia/Kolkata',
    passcodeHash,
    passcodeHint: 'demoPass123 (10 characters)',
    isDemo: true,
    members: [
      {
        uid: DEMO_USERS.caretaker.uid,
        name: DEMO_USERS.caretaker.name,
        email: DEMO_USERS.caretaker.email,
        role: ROLES.CARETAKER,
        joinedAt: new Date(now.getTime() - 7 * 86400000).toISOString()
      },
      {
        uid: DEMO_USERS.family.uid,
        name: DEMO_USERS.family.name,
        email: DEMO_USERS.family.email,
        role: ROLES.FAMILY,
        joinedAt: new Date(now.getTime() - 5 * 86400000).toISOString()
      }
    ],
    permissions: {
      caretakerCanManageMeds: true,
      caretakerCanLogDoses: true,
      caretakerCanManageAppointments: true,
      familyCanLogDoses: false,
      familyCanManageMeds: false,
      familyCanManageAppointments: false,
      familyCanViewVitals: true
    },
    createdAt: new Date(now.getTime() - 14 * 86400000).toISOString()
  };

  await circleRef.set(demoCircleData, { merge: true });

  // 2. Seed Medications (clearly marked with verified vs unverified packaging sources)
  const med1Id = 'med_demo_metformin';
  const med2Id = 'med_demo_amlodipine';
  const med3Id = 'med_demo_atorvastatin';

  await db
    .collection('medications')
    .doc(med1Id)
    .set(
      {
        id: med1Id,
        circleId: DEMO_CIRCLE_ID,
        name: 'Metformin Hydrochloride [DEMO]',
        strength: '500mg',
        form: 'Tablet',
        times: ['08:00', '20:00'],
        schedules: [{ time: '08:00' }, { time: '20:00' }],
        instructions: 'Take 1 tablet after meals with water. Do not crush.',
        packagingInstructions: 'Take 1 tablet after meals with water. Do not crush.',
        sourceLabel: 'From the packaging',
        notes: 'White oval tablet with score line [SIMULATED]',
        active: true,
        isDemo: true
      },
      { merge: true }
    );

  await db
    .collection('medications')
    .doc(med2Id)
    .set(
      {
        id: med2Id,
        circleId: DEMO_CIRCLE_ID,
        name: 'Amlodipine Besylate [DEMO]',
        strength: '5mg',
        form: 'Tablet',
        times: ['09:00'],
        schedules: [{ time: '09:00' }],
        instructions: 'Take in the morning with a glass of water.',
        packagingInstructions: 'Take in the morning with a glass of water.',
        sourceLabel: 'From the packaging',
        notes: 'Small white round tablet [SIMULATED]',
        active: true,
        isDemo: true
      },
      { merge: true }
    );

  await db
    .collection('medications')
    .doc(med3Id)
    .set(
      {
        id: med3Id,
        circleId: DEMO_CIRCLE_ID,
        name: 'Atorvastatin [DEMO]',
        strength: '10mg',
        form: 'Tablet',
        times: ['21:00'],
        schedules: [{ time: '21:00' }],
        instructions: 'Take once daily at bedtime.',
        packagingInstructions: 'Take once daily at bedtime.',
        sourceLabel: 'Not verified - ask your pharmacist or doctor',
        notes: 'Yellow film-coated tablet [SIMULATED]',
        active: true,
        isDemo: true
      },
      { merge: true }
    );

  // 3. Seed Today's Doses with different realistic statuses (Taken, Pending, Missed)
  const dose1Id = `${DEMO_CIRCLE_ID}_${med1Id}_${todayStr}_08:00`;
  const dose2Id = `${DEMO_CIRCLE_ID}_${med2Id}_${todayStr}_09:00`;
  const dose3Id = `${DEMO_CIRCLE_ID}_${med1Id}_${todayStr}_20:00`;
  const dose4Id = `${DEMO_CIRCLE_ID}_${med3Id}_${todayStr}_21:00`;

  await db
    .collection('doseLogs')
    .doc(dose1Id)
    .set(
      {
        id: dose1Id,
        circleId: DEMO_CIRCLE_ID,
        medicationId: med1Id,
        medicineName: 'Metformin Hydrochloride [DEMO]',
        strength: '500mg',
        form: 'Tablet',
        scheduledDate: todayStr,
        scheduledTime: '08:00',
        status: DOSE_STATUS.TAKEN,
        sourceLabel: 'From the packaging',
        instructions: 'Take 1 tablet after meals with water',
        loggedAt: new Date(now.getTime() - 2 * 3600000).toISOString(),
        loggedBy: { uid: DEMO_USERS.elder.uid, name: DEMO_USERS.elder.name, role: ROLES.ELDER },
        isDemo: true
      },
      { merge: true }
    );

  await db
    .collection('doseLogs')
    .doc(dose2Id)
    .set(
      {
        id: dose2Id,
        circleId: DEMO_CIRCLE_ID,
        medicationId: med2Id,
        medicineName: 'Amlodipine Besylate [DEMO]',
        strength: '5mg',
        form: 'Tablet',
        scheduledDate: todayStr,
        scheduledTime: '09:00',
        status: DOSE_STATUS.MISSED,
        sourceLabel: 'From the packaging',
        instructions: 'Take in the morning with a glass of water',
        missedReason: 'Patient was out for morning walk',
        loggedAt: new Date(now.getTime() - 1 * 3600000).toISOString(),
        loggedBy: {
          uid: DEMO_USERS.caretaker.uid,
          name: DEMO_USERS.caretaker.name,
          role: ROLES.CARETAKER
        },
        missedAlertSent: true,
        escalationSent: true,
        isDemo: true
      },
      { merge: true }
    );

  await db.collection('doseLogs').doc(dose3Id).set(
    {
      id: dose3Id,
      circleId: DEMO_CIRCLE_ID,
      medicationId: med1Id,
      medicineName: 'Metformin Hydrochloride [DEMO]',
      strength: '500mg',
      form: 'Tablet',
      scheduledDate: todayStr,
      scheduledTime: '20:00',
      status: DOSE_STATUS.PENDING,
      sourceLabel: 'From the packaging',
      instructions: 'Take 1 tablet after dinner with water',
      reminderSent: false,
      isDemo: true
    },
    { merge: true }
  );

  await db.collection('doseLogs').doc(dose4Id).set(
    {
      id: dose4Id,
      circleId: DEMO_CIRCLE_ID,
      medicationId: med3Id,
      medicineName: 'Atorvastatin [DEMO]',
      strength: '10mg',
      form: 'Tablet',
      scheduledDate: todayStr,
      scheduledTime: '21:00',
      status: DOSE_STATUS.PENDING,
      sourceLabel: 'Not verified - ask your pharmacist or doctor',
      instructions: 'Take once daily at bedtime',
      reminderSent: false,
      isDemo: true
    },
    { merge: true }
  );

  // 4. Seed Appointments
  const appt1Id = 'appt_demo_cardio';
  const appt2Id = 'appt_demo_general';

  const tomorrow = new Date(now.getTime() + 24 * 3600000);
  tomorrow.setHours(10, 30, 0, 0);

  const nextWeek = new Date(now.getTime() + 4 * 24 * 3600000);
  nextWeek.setHours(16, 0, 0, 0);

  await db.collection('appointments').doc(appt1Id).set(
    {
      id: appt1Id,
      circleId: DEMO_CIRCLE_ID,
      doctorName: 'Dr. Rajesh Khanna [DEMO]',
      purpose: 'Cardiology Review',
      specialty: 'Cardiology Review',
      datetime: tomorrow.toISOString(),
      place: 'Metro Heart Institute, Sector 14 [DEMO]',
      location: 'Metro Heart Institute, Sector 14 [DEMO]',
      notes: 'Bring fasting lipid profile and previous ECG record [SIMULATED]',
      status: 'Upcoming',
      reminderSent: false,
      isDemo: true
    },
    { merge: true }
  );

  await db.collection('appointments').doc(appt2Id).set(
    {
      id: appt2Id,
      circleId: DEMO_CIRCLE_ID,
      doctorName: 'Dr. Meenakshi Sundaram [DEMO]',
      purpose: 'General Physician Routine Checkup',
      specialty: 'General Physician Routine Checkup',
      datetime: nextWeek.toISOString(),
      place: 'City Healthcare Clinic [DEMO]',
      location: 'City Healthcare Clinic [DEMO]',
      notes: 'Regular 3-month elder health screening [SIMULATED]',
      status: 'Upcoming',
      reminderSent: false,
      isDemo: true
    },
    { merge: true }
  );

  return {
    success: true,
    circleId: DEMO_CIRCLE_ID,
    elder: DEMO_USERS.elder,
    caretaker: DEMO_USERS.caretaker,
    family: DEMO_USERS.family
  };
}
