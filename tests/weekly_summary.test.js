import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../server/app.js';
import { getDb } from '../server/db.js';
import { config } from '../server/config.js';
import { clearSentEmailsLog, getSentEmailsLog } from '../server/services/emailService.js';
import {
  getTimeOfDaySlot,
  computeWeeklySummaryData,
  getWeeklySummaryRecipients,
  processWeeklySummaryForCircle
} from '../server/services/weeklySummaryService.js';
import {
  generateTemplateWeeklySummary,
  generateWeeklyFamilySummaryWithGemini
} from '../server/services/geminiService.js';

test('Weekly Family Summary Suite: Aggregation, Gemini / Fallback & Recipient Permissions', async (t) => {
  let elderToken = '';
  let elderUid = '';
  let caretakerToken = '';
  let caretakerUid = '';
  let familyAllowedToken = '';
  let familyAllowedUid = '';
  let familyBlockedToken = '';
  let familyBlockedUid = '';
  let circleId = '';

  const elderEmail = `elder.weekly.${Date.now()}@carecircle.demo`;
  const caretakerEmail = `caretaker.weekly.${Date.now()}@carecircle.demo`;
  const familyAllowedEmail = `family.allowed.${Date.now()}@carecircle.demo`;
  const familyBlockedEmail = `family.blocked.${Date.now()}@carecircle.demo`;

  await t.test('Setup: Create Circle with Elder, Caretaker, and 2 Family Members', async () => {
    // 1. Elder
    const elderRes = await request(app).post('/api/auth/register').send({
      email: elderEmail,
      password: 'password123',
      name: 'Kamla Devi',
      role: 'elder'
    });
    assert.equal(elderRes.status, 201);
    elderToken = elderRes.body.token;
    elderUid = elderRes.body.user.uid;

    const circleRes = await request(app)
      .post('/api/circles/create')
      .set('Authorization', `Bearer ${elderToken}`)
      .send({
        name: 'Kamla Devi Care Circle',
        elderName: 'Kamla Devi',
        passcode: 'kamlaPass123',
        timezone: 'Asia/Kolkata'
      });
    assert.equal(circleRes.status, 201);
    circleId = circleRes.body.circle.id;

    // 2. Caretaker
    const caretakerRes = await request(app).post('/api/auth/register').send({
      email: caretakerEmail,
      password: 'password123',
      name: 'Caretaker Maya',
      role: 'caretaker'
    });
    assert.equal(caretakerRes.status, 201);
    caretakerToken = caretakerRes.body.token;
    caretakerUid = caretakerRes.body.user.uid;

    await request(app)
      .post('/api/circles/join')
      .set('Authorization', `Bearer ${caretakerToken}`)
      .send({ circleId, passcode: 'kamlaPass123', role: 'caretaker' });

    // 3. Family Member 1 (Allowed)
    const fam1Res = await request(app).post('/api/auth/register').send({
      email: familyAllowedEmail,
      password: 'password123',
      name: 'Daughter Anita',
      role: 'family'
    });
    assert.equal(fam1Res.status, 201);
    familyAllowedToken = fam1Res.body.token;
    familyAllowedUid = fam1Res.body.user.uid;

    await request(app)
      .post('/api/circles/join')
      .set('Authorization', `Bearer ${familyAllowedToken}`)
      .send({ circleId, passcode: 'kamlaPass123', role: 'family' });

    // 4. Family Member 2 (Will have weekly alerts opted out / blocked by Elder)
    const fam2Res = await request(app).post('/api/auth/register').send({
      email: familyBlockedEmail,
      password: 'password123',
      name: 'Son Rajesh',
      role: 'family'
    });
    assert.equal(fam2Res.status, 201);
    familyBlockedToken = fam2Res.body.token;
    familyBlockedUid = fam2Res.body.user.uid;

    await request(app)
      .post('/api/circles/join')
      .set('Authorization', `Bearer ${familyBlockedToken}`)
      .send({ circleId, passcode: 'kamlaPass123', role: 'family' });

    // Elder explicitly disables weekly summary alerts for Family Member 2
    await request(app)
      .put(`/api/circles/${circleId}/members/${familyBlockedUid}/permissions`)
      .set('Authorization', `Bearer ${elderToken}`)
      .send({
        permissions: {
          alertWeeklySummary: false
        }
      });
  });

  await t.test('1. Time-of-Day Slot Classification and Data Aggregation', async () => {
    // Unit test slot classifications
    assert.equal(getTimeOfDaySlot('07:30'), 'morning');
    assert.equal(getTimeOfDaySlot('11:45'), 'morning');
    assert.equal(getTimeOfDaySlot('12:00'), 'afternoon');
    assert.equal(getTimeOfDaySlot('15:30'), 'afternoon');
    assert.equal(getTimeOfDaySlot('18:15'), 'evening');
    assert.equal(getTimeOfDaySlot('20:45'), 'evening');
    assert.equal(getTimeOfDaySlot('21:00'), 'night');
    assert.equal(getTimeOfDaySlot('23:30'), 'night');
    assert.equal(getTimeOfDaySlot('02:00'), 'night');

    // Seed a week of dose records:
    // Reference date: 2026-11-15
    const db = getDb();
    const refDate = new Date('2026-11-15T12:00:00Z');

    // Seed 10 doses across past 7 days:
    // - 7 Taken
    // - 3 Missed: 2 in morning (08:00, 09:00), 1 in evening (19:00)
    const seedDoses = [
      { id: `w_dose_1_${Date.now()}`, date: '2026-11-10', time: '08:00', status: 'Taken', med: 'Metformin' },
      { id: `w_dose_2_${Date.now()}`, date: '2026-11-10', time: '13:00', status: 'Taken', med: 'Multivitamin' },
      { id: `w_dose_3_${Date.now()}`, date: '2026-11-11', time: '08:00', status: 'Missed', med: 'Metformin' }, // Morning Missed
      { id: `w_dose_4_${Date.now()}`, date: '2026-11-11', time: '20:00', status: 'Taken', med: 'Atorvastatin' },
      { id: `w_dose_5_${Date.now()}`, date: '2026-11-12', time: '08:30', status: 'Missed', med: 'Metformin' }, // Morning Missed
      { id: `w_dose_6_${Date.now()}`, date: '2026-11-13', time: '14:00', status: 'Taken', med: 'Calcium' },
      { id: `w_dose_7_${Date.now()}`, date: '2026-11-13', time: '19:30', status: 'Missed', med: 'BP Tablet' }, // Evening Missed
      { id: `w_dose_8_${Date.now()}`, date: '2026-11-14', time: '08:00', status: 'Taken', med: 'Metformin' },
      { id: `w_dose_9_${Date.now()}`, date: '2026-11-14', time: '21:30', status: 'Taken', med: 'Sleep Aid' },
      { id: `w_dose_10_${Date.now()}`, date: '2026-11-15', time: '08:00', status: 'Taken', med: 'Metformin' }
    ];

    for (const d of seedDoses) {
      await db.collection('doseLogs').doc(d.id).set({
        id: d.id,
        circleId,
        scheduledDate: d.date,
        scheduledTime: d.time,
        status: d.status,
        medicineName: d.med
      });
    }

    const circleDoc = (await db.collection('careCircles').doc(circleId).get()).data();
    const summaryData = await computeWeeklySummaryData(circleDoc, refDate);

    // Verify adherence computation: 7 taken / 10 total due = 70%
    assert.equal(summaryData.totalDue, 10);
    assert.equal(summaryData.takenCount, 7);
    assert.equal(summaryData.missedCount, 3);
    assert.equal(summaryData.adherenceRate, 70);

    // Verify time of day aggregation
    assert.equal(summaryData.missedByTimeOfDay.morning, 2, '2 missed doses in morning');
    assert.equal(summaryData.missedByTimeOfDay.afternoon, 0, '0 missed doses in afternoon');
    assert.equal(summaryData.missedByTimeOfDay.evening, 1, '1 missed dose in evening');
    assert.equal(summaryData.missedByTimeOfDay.night, 0, '0 missed doses at night');

    // Verify most missed slot correctly identified
    assert.equal(summaryData.mostMissedSlot, 'morning');

    // Verify only first name used
    assert.equal(summaryData.elderFirstName, 'Kamla');
  });

  await t.test('2. Fallback Behaviour: Safe template provides 3 to 5 plain sentences with zero medical advice', async () => {
    // Generate deterministic template summary
    const templateOutput = generateTemplateWeeklySummary({
      elderFirstName: 'Kamla',
      adherenceRate: 70,
      totalDue: 10,
      takenCount: 7,
      missedCount: 3,
      missedByTimeOfDay: { morning: 2, afternoon: 0, evening: 1, night: 0 },
      mostMissedSlot: 'morning'
    });

    assert.ok(typeof templateOutput === 'string');
    assert.ok(templateOutput.length > 50);

    // Sentence count check: split on sentence boundaries
    const sentences = templateOutput.match(/[^.!?]+[.!?]+/g) || [];
    assert.ok(sentences.length >= 3 && sentences.length <= 5, `Expected 3 to 5 sentences, got ${sentences.length}`);

    // Privacy check: only first name used
    assert.match(templateOutput, /Kamla/);
    assert.doesNotMatch(templateOutput, /Devi/);

    // Context check: mentions morning slot as most missed
    assert.match(templateOutput, /morning/i);
    assert.match(templateOutput, /70%/);

    // Safety checks: no medical advice or suggesting changes
    assert.doesNotMatch(templateOutput, /change.*medicine|alter.*dose|consult.*physician|doctor.*advised|increase.*dosage/i);

    // Test Gemini service call in fallback mode (when no API key or on error)
    const geminiRes = await generateWeeklyFamilySummaryWithGemini({
      elderFirstName: 'Kamla',
      adherenceRate: 70,
      totalDue: 10,
      takenCount: 7,
      missedCount: 3,
      missedByTimeOfDay: { morning: 2, afternoon: 0, evening: 1, night: 0 },
      mostMissedSlot: 'morning'
    });

    assert.ok(geminiRes.summaryText);
    const geminiSentences = geminiRes.summaryText.match(/[^.!?]+[.!?]+/g) || [];
    assert.ok(geminiSentences.length >= 3 && geminiSentences.length <= 5);
  });

  await t.test('3. Recipient Permissions: Only elder-allowed members receive the weekly summary email', async () => {
    clearSentEmailsLog();
    const db = getDb();
    const circleDoc = (await db.collection('careCircles').doc(circleId).get()).data();

    // Verify recipient filtering logic
    const recipients = getWeeklySummaryRecipients(circleDoc);

    // Elder is always included
    assert.ok(recipients.includes(elderEmail), 'Elder must receive weekly summary');

    // Caretaker is included (alertWeeklySummary default true)
    assert.ok(recipients.includes(caretakerEmail), 'Permitted caretaker must receive weekly summary');

    // Family Member 1 (Allowed) is included
    assert.ok(recipients.includes(familyAllowedEmail), 'Allowed family member must receive weekly summary');

    // Family Member 2 (Explicitly blocked by Elder) is EXCLUDED
    assert.equal(
      recipients.includes(familyBlockedEmail),
      false,
      'Family member opted out / blocked by Elder must NOT receive weekly summary'
    );

    // Dispatch the weekly summary via processWeeklySummaryForCircle
    const dispatchRes = await processWeeklySummaryForCircle({
      circle: circleDoc,
      sendEmail: true,
      forceSend: true
    });

    assert.equal(dispatchRes.emailsSent, 3, 'Exactly 3 emails sent (Elder, Caretaker, Allowed Family)');

    const sentMails = getSentEmailsLog().filter(e => e.subject.includes('Weekly Care Circle Digest'));
    assert.equal(sentMails.length, 3);

    const sentToAddresses = sentMails.map(e => e.to);
    assert.ok(sentToAddresses.includes(elderEmail));
    assert.ok(sentToAddresses.includes(caretakerEmail));
    assert.ok(sentToAddresses.includes(familyAllowedEmail));
    assert.equal(sentToAddresses.includes(familyBlockedEmail), false);

    // Verify email text format
    const sampleMail = sentMails[0];
    assert.match(sampleMail.text, /Weekly Care Summary for Kamla/i);
    assert.match(sampleMail.text, /70% adherence/i);
  });

  await t.test('4. Dashboard API & Scheduler Cron Integration', async () => {
    // 1. GET /api/circles/:circleId/weekly-summary
    const getSummaryRes = await request(app)
      .get(`/api/circles/${circleId}/weekly-summary`)
      .set('Authorization', `Bearer ${elderToken}`);

    assert.equal(getSummaryRes.status, 200);
    assert.equal(getSummaryRes.body.success, true);
    assert.equal(getSummaryRes.body.summary.adherenceRate, 70);
    assert.equal(getSummaryRes.body.summary.mostMissedSlot, 'morning');
    assert.ok(getSummaryRes.body.summary.summaryText);

    // 2. Non-circle member cannot access weekly summary
    const otherUserRes = await request(app).post('/api/auth/register').send({
      email: `stranger.weekly.${Date.now()}@carecircle.demo`,
      password: 'password123',
      name: 'Stranger Danger',
      role: 'family'
    });
    const strangerToken = otherUserRes.body.token;

    const forbiddenRes = await request(app)
      .get(`/api/circles/${circleId}/weekly-summary`)
      .set('Authorization', `Bearer ${strangerToken}`);
    assert.equal(forbiddenRes.status, 403);

    // 3. Cloud Scheduler Cron Endpoint: POST /api/cron/weekly-summary
    clearSentEmailsLog();
    const cronWeeklyRes = await request(app)
      .post('/api/cron/weekly-summary')
      .set('x-cron-secret', config.cronSecret)
      .send({
        circleId,
        forceSend: true
      });

    assert.equal(cronWeeklyRes.status, 200);
    assert.equal(cronWeeklyRes.body.success, true);
    assert.ok(cronWeeklyRes.body.result.weeklySummariesSent >= 1);
  });
});
