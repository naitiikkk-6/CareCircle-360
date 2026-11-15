import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../server/app.js';
import { config } from '../server/config.js';
import { clearSentEmailsLog, getSentEmailsLog } from '../server/services/emailService.js';
import { safeCompare } from '../server/routes/cronRoutes.js';
import { getDb } from '../server/db.js';

test('Email Reminder & Cloud Scheduler Cron System Suite', async (t) => {
  let elderToken = '';
  let caretakerToken = '';
  let familyToken = '';
  let circleId = '';

  const elderEmail = 'elder.ramesh@carecircle.demo';
  const caretakerEmail = 'caretaker.priya@carecircle.demo';
  const familyEmail = 'family.arun@carecircle.demo';

  await t.test('Setup: Create circle with Elder, Caretaker, and Family member', async () => {
    clearSentEmailsLog();

    const elderLogin = await request(app).post('/api/auth/demo-login').send({ persona: 'elder' });
    elderToken = elderLogin.body.token;

    const caretakerLogin = await request(app).post('/api/auth/demo-login').send({ persona: 'caretaker' });
    caretakerToken = caretakerLogin.body.token;

    const familyLogin = await request(app).post('/api/auth/demo-login').send({ persona: 'family' });
    familyToken = familyLogin.body.token;

    const createRes = await request(app)
      .post('/api/circles/create')
      .set('Authorization', `Bearer ${elderToken}`)
      .send({
        name: 'Cron Test Circle',
        elderName: 'Rameshji',
        passcode: 'cronPass123'
      });
    assert.equal(createRes.status, 201);
    circleId = createRes.body.circle.id;

    // Update elder email and join caretaker & family
    const db = getDb();
    await db.collection('careCircles').doc(circleId).update({
      elderEmail,
      timezone: 'Asia/Kolkata',
      graceWindowMinutes: 60
    });

    await request(app)
      .post('/api/circles/join')
      .set('Authorization', `Bearer ${caretakerToken}`)
      .send({ circleId, passcode: 'cronPass123', role: 'caretaker' });

    await request(app)
      .post('/api/circles/join')
      .set('Authorization', `Bearer ${familyToken}`)
      .send({ circleId, passcode: 'cronPass123', role: 'family' });

    // Explicitly set member emails for verification
    await db.collection('careCircles').doc(circleId).update({
      members: [
        { uid: 'uid_caretaker', name: 'Priya', email: caretakerEmail, role: 'caretaker' },
        { uid: 'uid_family', name: 'Arun', email: familyEmail, role: 'family' }
      ]
    });
  });

  await t.test('1. Secret Header Required (Constant-Time Verification)', async () => {
    // 1. Missing secret header
    const resNoHeader = await request(app)
      .post('/api/cron/reminders')
      .send({ circleId });
    assert.equal(resNoHeader.status, 401);
    assert.match(resNoHeader.body.error, /Secret header required/i);

    // 2. Wrong secret header
    const resWrongHeader = await request(app)
      .post('/api/cron/reminders')
      .set('x-cron-secret', 'completely-incorrect-secret-key')
      .send({ circleId });
    assert.equal(resWrongHeader.status, 401);
    assert.match(resWrongHeader.body.error, /Secret header required/i);

    // 3. Verify constant-time string comparison function
    assert.equal(safeCompare('valid-secret-123', 'valid-secret-123'), true);
    assert.equal(safeCompare('valid-secret-123', 'invalid-secret-xyz'), false);
    assert.equal(safeCompare('short', 'much-longer-secret-value'), false);
    assert.equal(safeCompare(null, 'secret'), false);

    // 4. Valid secret header succeeds
    const resValid = await request(app)
      .post('/api/cron/reminders')
      .set('x-cron-secret', config.cronSecret)
      .send({ circleId });
    assert.equal(resValid.status, 200);
    assert.equal(resValid.body.success, true);
    assert.ok(resValid.body.result);
  });

  await t.test('2. Mock Mode Used in Tests', async () => {
    // Ensure mock mode is active
    assert.equal(config.emailMockMode, true, 'Tests must run in safe email mock mode');

    clearSentEmailsLog();
    const emailsBefore = getSentEmailsLog().length;
    assert.equal(emailsBefore, 0);
  });

  await t.test('3. Due-Soon Selection: Doses due within next 15 minutes', async () => {
    clearSentEmailsLog();
    const db = getDb();

    // Reference time: 10:00 AM Kolkata time today
    const refDate = new Date();
    refDate.setHours(10, 0, 0, 0);
    const todayStr = refDate.toISOString().split('T')[0];

    // Seed 2 doses:
    // Dose A: 10:10 (due in 10 minutes -> within [0, 15] minute window)
    // Dose B: 10:45 (due in 45 minutes -> outside [0, 15] minute window)
    const doseAId = `dose_due_soon_${Date.now()}`;
    const doseBId = `dose_later_${Date.now()}`;

    await db.collection('doseLogs').doc(doseAId).set({
      id: doseAId,
      circleId,
      medicineName: 'Amlodipine Besylate',
      strength: '5mg',
      scheduledDate: todayStr,
      scheduledTime: '10:10',
      status: 'Pending',
      reminderSent: false,
      instructions: 'Take with morning water'
    });

    await db.collection('doseLogs').doc(doseBId).set({
      id: doseBId,
      circleId,
      medicineName: 'Atorvastatin',
      strength: '20mg',
      scheduledDate: todayStr,
      scheduledTime: '10:45',
      status: 'Pending',
      reminderSent: false,
      instructions: 'Take after meals'
    });

    // Run cron with reference time 10:00
    const cronRes = await request(app)
      .post('/api/cron/reminders')
      .set('x-cron-secret', config.cronSecret)
      .send({
        circleId,
        referenceDate: refDate.toISOString()
      });

    assert.equal(cronRes.status, 200);
    assert.equal(cronRes.body.result.upcomingRemindersSent >= 1, true);

    // Verify dose A is flagged as reminderSent = true
    const updatedDoseA = (await db.collection('doseLogs').doc(doseAId).get()).data();
    assert.equal(updatedDoseA.reminderSent, true);

    // Verify dose B was NOT flagged (not due within 15 mins)
    const updatedDoseB = (await db.collection('doseLogs').doc(doseBId).get()).data();
    assert.equal(updatedDoseB.reminderSent, false);

    // Verify email recipients & content
    const sent = getSentEmailsLog();
    assert.ok(sent.length > 0);

    const amlodipineEmails = sent.filter(e => e.subject.includes('Amlodipine Besylate'));
    assert.ok(amlodipineEmails.length >= 1);

    // Elder receives reminder
    const elderMail = amlodipineEmails.find(e => e.to === elderEmail);
    assert.ok(elderMail, 'Elder must receive upcoming dose reminder');
    assert.match(elderMail.text, /Rameshji/i);
    assert.match(elderMail.text, /10:10/);
    assert.match(elderMail.text, /Amlodipine Besylate/);

    // Caretaker receives reminder
    const caretakerMail = amlodipineEmails.find(e => e.to === caretakerEmail);
    assert.ok(caretakerMail, 'Caretaker must receive upcoming dose reminder');

    // Family member does NOT receive upcoming intake reminder by default
    const familyMail = amlodipineEmails.find(e => e.to === familyEmail);
    assert.equal(familyMail, undefined, 'Family member should not receive intake reminder unless elder enabled it');
  });

  await t.test('4. Missed Detection: Mark overdue doses as Missed and email alert', async () => {
    clearSentEmailsLog();
    const db = getDb();

    // Reference time: 10:00 AM Kolkata time today
    const refDate = new Date();
    refDate.setHours(10, 0, 0, 0);
    const todayStr = refDate.toISOString().split('T')[0];

    // Seed 2 doses:
    // Dose C: Scheduled at 08:30 (90 mins ago -> exceeds 60-min grace window -> Overdue!)
    // Dose D: Scheduled at 09:40 (20 mins ago -> within 60-min grace window -> still Pending)
    const doseCId = `dose_overdue_${Date.now()}`;
    const doseDId = `dose_in_grace_${Date.now()}`;

    await db.collection('doseLogs').doc(doseCId).set({
      id: doseCId,
      circleId,
      medicineName: 'Metformin Hydrochloride',
      strength: '500mg',
      scheduledDate: todayStr,
      scheduledTime: '08:30',
      status: 'Pending',
      reminderSent: true,
      missedAlertSent: false
    });

    await db.collection('doseLogs').doc(doseDId).set({
      id: doseDId,
      circleId,
      medicineName: 'Vitamin D3',
      strength: '1000 IU',
      scheduledDate: todayStr,
      scheduledTime: '09:40',
      status: 'Pending',
      reminderSent: true,
      missedAlertSent: false
    });

    // Run cron with reference time 10:00
    const cronRes = await request(app)
      .post('/api/cron/reminders')
      .set('x-cron-secret', config.cronSecret)
      .send({
        circleId,
        referenceDate: refDate.toISOString()
      });

    assert.equal(cronRes.status, 200);
    assert.ok(cronRes.body.result.missedDosesMarked >= 1);
    assert.ok(cronRes.body.result.missedAlertsSent >= 1);

    // Verify Dose C marked as Missed in DB
    const updatedDoseC = (await db.collection('doseLogs').doc(doseCId).get()).data();
    assert.equal(updatedDoseC.status, 'Missed');
    assert.equal(updatedDoseC.missedAlertSent, true);
    assert.match(updatedDoseC.missedReason, /grace window elapsed/i);

    // Verify Dose D remains Pending (grace period not expired)
    const updatedDoseD = (await db.collection('doseLogs').doc(doseDId).get()).data();
    assert.equal(updatedDoseD.status, 'Pending');
    assert.equal(updatedDoseD.missedAlertSent, false);

    // Check missed dose alert email
    const sent = getSentEmailsLog();
    const missedEmails = sent.filter(e => e.subject.includes('Missed Medication Alert'));
    assert.ok(missedEmails.length >= 2, 'Elder, Caretaker and Family receive missed escalations');

    const familyMissedMail = missedEmails.find(e => e.to === familyEmail);
    assert.ok(familyMissedMail, 'Family member must receive safety escalation for missed dose');
    assert.match(familyMissedMail.text, /Metformin Hydrochloride/);
    assert.match(familyMissedMail.text, /Rameshji/);
  });

  await t.test('5. Appointments in next 24 hours: Reminder sent to circle members', async () => {
    clearSentEmailsLog();
    const db = getDb();

    const refDate = new Date();
    // Appt 1: in 12 hours (within 24h window)
    const apptIn12h = new Date(refDate.getTime() + 12 * 60 * 60 * 1000).toISOString();
    // Appt 2: in 48 hours (outside 24h window)
    const apptIn48h = new Date(refDate.getTime() + 48 * 60 * 60 * 1000).toISOString();

    const appt1Id = `appt_soon_${Date.now()}`;
    const appt2Id = `appt_later_${Date.now()}`;

    await db.collection('appointments').doc(appt1Id).set({
      id: appt1Id,
      circleId,
      doctorName: 'Dr. Sunil Kulkarni',
      purpose: 'Endocrinology Checkup',
      datetime: apptIn12h,
      place: 'Apex Diabetes Care',
      status: 'Upcoming',
      reminderSent: false
    });

    await db.collection('appointments').doc(appt2Id).set({
      id: appt2Id,
      circleId,
      doctorName: 'Dr. Meenakshi Sundaram',
      purpose: 'General Health Annual',
      datetime: apptIn48h,
      place: 'Metro General Hospital',
      status: 'Upcoming',
      reminderSent: false
    });

    const cronRes = await request(app)
      .post('/api/cron/reminders')
      .set('x-cron-secret', config.cronSecret)
      .send({
        circleId,
        referenceDate: refDate.toISOString()
      });

    assert.equal(cronRes.status, 200);
    assert.ok(cronRes.body.result.appointmentRemindersSent >= 1);

    // Verify Appt 1 marked as reminderSent = true
    const updatedAppt1 = (await db.collection('appointments').doc(appt1Id).get()).data();
    assert.equal(updatedAppt1.reminderSent, true);

    // Verify Appt 2 remains reminderSent = false
    const updatedAppt2 = (await db.collection('appointments').doc(appt2Id).get()).data();
    assert.equal(updatedAppt2.reminderSent, false);

    // Verify appointment email sent
    const sent = getSentEmailsLog();
    const apptEmails = sent.filter(e => e.subject.includes('Dr. Sunil Kulkarni'));
    assert.ok(apptEmails.length >= 1);
    assert.match(apptEmails[0].text, /Apex Diabetes Care/);
    assert.match(apptEmails[0].text, /Endocrinology/);
  });

  await t.test('6. Duplicate Prevention: Subsequent cron execution sends ZERO duplicates', async () => {
    clearSentEmailsLog();

    const refDate = new Date();

    // Run the cron again immediately
    const cronRes = await request(app)
      .post('/api/cron/reminders')
      .set('x-cron-secret', config.cronSecret)
      .send({
        circleId,
        referenceDate: refDate.toISOString()
      });

    assert.equal(cronRes.status, 200);

    // All counts should be 0 because all eligible doses and appointments are already marked as sent
    assert.equal(cronRes.body.result.upcomingRemindersSent, 0);
    assert.equal(cronRes.body.result.missedAlertsSent, 0);
    assert.equal(cronRes.body.result.appointmentRemindersSent, 0);

    // Zero duplicate emails in log
    const duplicateEmails = getSentEmailsLog();
    assert.equal(duplicateEmails.length, 0, 'No duplicate emails should be sent on repeated cron runs');
  });
});
