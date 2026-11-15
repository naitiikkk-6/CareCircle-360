import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../server/app.js';
import { getDb } from '../server/db.js';
import { config } from '../server/config.js';
import { clearSentEmailsLog, getSentEmailsLog } from '../server/services/emailService.js';
import { generateOneClickToken } from '../server/services/tokenService.js';

test('Elder-Centred Controls: Sharing Matrix, Immediate Revocation, Escalation & One-Click Tokens', async (t) => {
  let elderToken = '';
  let caretakerToken = '';
  let caretakerUid = '';
  let familyToken = '';
  let familyUid = '';
  let circleId = '';

  const elderEmail = `elder.ctrl.${Date.now()}@carecircle.demo`;
  const caretakerEmail = `caretaker.ctrl.${Date.now()}@carecircle.demo`;
  const familyEmail = `family.ctrl.${Date.now()}@carecircle.demo`;

  await t.test('Setup: Register Elder, Caretaker, Family and establish Circle', async () => {
    // 1. Elder registers and creates circle
    const elderRes = await request(app).post('/api/auth/register').send({
      email: elderEmail,
      password: 'password123',
      name: 'Elder Savitri Devi',
      role: 'elder'
    });
    assert.equal(elderRes.status, 201);
    elderToken = elderRes.body.token;
    assert.ok(elderRes.body.user.uid);

    const circleRes = await request(app)
      .post('/api/circles/create')
      .set('Authorization', `Bearer ${elderToken}`)
      .send({
        name: 'Savitri Devi Care Circle',
        elderName: 'Savitri Devi',
        passcode: 'savitriSafe456',
        timezone: 'Asia/Kolkata'
      });
    assert.equal(circleRes.status, 201);
    circleId = circleRes.body.circle.id;

    // 2. Caretaker registers and joins circle
    const caretakerRes = await request(app).post('/api/auth/register').send({
      email: caretakerEmail,
      password: 'password123',
      name: 'Nurse Rekha',
      role: 'caretaker'
    });
    assert.equal(caretakerRes.status, 201);
    caretakerToken = caretakerRes.body.token;
    caretakerUid = caretakerRes.body.user.uid;

    const joinCaretakerRes = await request(app)
      .post('/api/circles/join')
      .set('Authorization', `Bearer ${caretakerToken}`)
      .send({
        circleId,
        passcode: 'savitriSafe456',
        role: 'caretaker'
      });
    assert.equal(joinCaretakerRes.status, 200);

    // 3. Family registers and joins circle
    const familyRes = await request(app).post('/api/auth/register').send({
      email: familyEmail,
      password: 'password123',
      name: 'Son Vikram',
      role: 'family'
    });
    assert.equal(familyRes.status, 201);
    familyToken = familyRes.body.token;
    familyUid = familyRes.body.user.uid;

    const joinFamilyRes = await request(app)
      .post('/api/circles/join')
      .set('Authorization', `Bearer ${familyToken}`)
      .send({
        circleId,
        passcode: 'savitriSafe456',
        role: 'family'
      });
    assert.equal(joinFamilyRes.status, 200);
  });

  await t.test(
    '1. Server-Side Sharing Rules: Elder configures member permissions and server enforces them',
    async () => {
      // Caretaker by default can view meds
      const initialViewMeds = await request(app)
        .get('/api/medications')
        .set('Authorization', `Bearer ${caretakerToken}`)
        .set('x-circle-id', circleId);
      assert.equal(initialViewMeds.status, 200);

      // Elder explicitly strips Caretaker's permission to view medicines
      const updatePermsRes = await request(app)
        .put(`/api/circles/${circleId}/members/${caretakerUid}/permissions`)
        .set('Authorization', `Bearer ${elderToken}`)
        .send({
          permissions: {
            canViewMedicines: false,
            canViewDoses: true,
            canViewAppointments: true,
            canViewReadings: true
          }
        });
      assert.equal(updatePermsRes.status, 200);
      assert.equal(updatePermsRes.body.member.permissions.canViewMedicines, false);

      // Caretaker is now strictly blocked from viewing medicines with 403 Forbidden
      const blockedViewMeds = await request(app)
        .get('/api/medications')
        .set('Authorization', `Bearer ${caretakerToken}`)
        .set('x-circle-id', circleId);
      assert.equal(blockedViewMeds.status, 403);
      assert.match(blockedViewMeds.body.error, /permission denied.*view medications/i);

      // Elder explicitly strips Family's permission to view doses
      const stripFamilyDoses = await request(app)
        .put(`/api/circles/${circleId}/members/${familyUid}/permissions`)
        .set('Authorization', `Bearer ${elderToken}`)
        .send({
          permissions: {
            canViewDoses: false
          }
        });
      assert.equal(stripFamilyDoses.status, 200);

      // Family is now blocked from viewing doses and daily pulse
      const blockedFamilyDoses = await request(app)
        .get('/api/doses')
        .set('Authorization', `Bearer ${familyToken}`)
        .set('x-circle-id', circleId);
      assert.equal(blockedFamilyDoses.status, 403);

      const blockedFamilyPulse = await request(app)
        .get('/api/doses/pulse')
        .set('Authorization', `Bearer ${familyToken}`)
        .set('x-circle-id', circleId);
      assert.equal(blockedFamilyPulse.status, 403);

      // Elder explicitly grants Family permission to edit medicines
      const grantFamilyEditMeds = await request(app)
        .put(`/api/circles/${circleId}/members/${familyUid}/permissions`)
        .set('Authorization', `Bearer ${elderToken}`)
        .send({
          permissions: {
            canViewMedicines: true,
            canEditMedicines: true
          }
        });
      assert.equal(grantFamilyEditMeds.status, 200);

      // Family can now successfully add a medication
      const addMedRes = await request(app)
        .post('/api/medications')
        .set('Authorization', `Bearer ${familyToken}`)
        .set('x-circle-id', circleId)
        .send({
          circleId,
          name: 'Thyroxine Sodium',
          strength: '50 mcg',
          form: 'Tablet',
          startDate: '2026-01-01',
          frequencyType: 'daily',
          times: ['07:00'],
          instructions: 'Take fasting with empty stomach'
        });
      assert.equal(addMedRes.status, 201);
      assert.equal(addMedRes.body.medication.name, 'Thyroxine Sodium');

      // Non-elder (Family) cannot modify other member's permissions
      const nonElderAttempt = await request(app)
        .put(`/api/circles/${circleId}/members/${caretakerUid}/permissions`)
        .set('Authorization', `Bearer ${familyToken}`)
        .send({ permissions: { canViewMedicines: true } });
      assert.equal(nonElderAttempt.status, 403);
    }
  );

  await t.test(
    '2. Immediate Revocation: Revoke takes effect instantly on the next server call',
    async () => {
      // Caretaker can currently call circle info
      const circleInfoBefore = await request(app)
        .get(`/api/circles/${circleId}`)
        .set('Authorization', `Bearer ${caretakerToken}`);
      assert.equal(circleInfoBefore.status, 200);

      // Elder revokes Caretaker access
      const revokeRes = await request(app)
        .post(`/api/circles/${circleId}/members/${caretakerUid}/revoke`)
        .set('Authorization', `Bearer ${elderToken}`);
      assert.equal(revokeRes.status, 200);
      assert.equal(revokeRes.body.member.isRevoked, true);

      // Caretaker's immediate next API call is BLOCKED with 403
      const callAfterRevoke = await request(app)
        .get(`/api/circles/${circleId}`)
        .set('Authorization', `Bearer ${caretakerToken}`);
      assert.equal(callAfterRevoke.status, 403);
      assert.match(callAfterRevoke.body.error, /access to this care circle has been revoked/i);

      // Caretaker cannot read medications or any other resource
      const medCallAfterRevoke = await request(app)
        .get('/api/medications')
        .set('Authorization', `Bearer ${caretakerToken}`)
        .set('x-circle-id', circleId);
      assert.equal(medCallAfterRevoke.status, 403);

      // Elder restores Caretaker access
      const restoreRes = await request(app)
        .post(`/api/circles/${circleId}/members/${caretakerUid}/restore`)
        .set('Authorization', `Bearer ${elderToken}`);
      assert.equal(restoreRes.status, 200);
      assert.equal(restoreRes.body.member.isRevoked, false);

      // Caretaker's access is immediately unblocked
      const callAfterRestore = await request(app)
        .get(`/api/circles/${circleId}`)
        .set('Authorization', `Bearer ${caretakerToken}`);
      assert.equal(callAfterRestore.status, 200);
    }
  );

  await t.test(
    '3. One-Click Dose Confirmation: Verification, Tampering Defense, and Expiration',
    async () => {
      const db = getDb();
      const testDoseId = `dose_oneclick_${Date.now()}`;

      await db.collection('doseLogs').doc(testDoseId).set({
        id: testDoseId,
        circleId,
        medicineName: 'Aspirin Cardio',
        strength: '75mg',
        scheduledDate: '2026-11-15',
        scheduledTime: '08:00',
        status: 'Missed',
        reminderSent: true,
        missedAlertSent: true
      });

      // 1. Generate valid token
      const validToken = generateOneClickToken({
        doseId: testDoseId,
        circleId,
        action: 'Taken',
        expiresInHours: 24
      });
      assert.ok(validToken.includes('.'));

      // 2. Reject tampered token (signature modified)
      const tamperedToken = validToken.substring(0, validToken.length - 4) + 'abcd';
      const tamperedRes = await request(app)
        .post('/api/doses/one-click-confirm')
        .send({ token: tamperedToken });
      assert.equal(tamperedRes.status, 400);
      assert.match(tamperedRes.body.error, /invalid.*signature|tampering/i);

      // 3. Reject expired token
      const expiredToken = generateOneClickToken({
        doseId: testDoseId,
        circleId,
        action: 'Taken',
        expiresInHours: -2 // expired 2 hours ago
      });
      const expiredRes = await request(app)
        .post('/api/doses/one-click-confirm')
        .send({ token: expiredToken });
      assert.equal(expiredRes.status, 400);
      assert.equal(expiredRes.body.expired, true);
      assert.match(expiredRes.body.error, /expired/i);

      // 4. Confirm with valid token via POST
      const confirmRes = await request(app)
        .post('/api/doses/one-click-confirm')
        .send({ token: validToken });
      assert.equal(confirmRes.status, 200);
      assert.equal(confirmRes.body.success, true);
      assert.equal(confirmRes.body.dose.status, 'Taken');
      assert.equal(confirmRes.body.dose.oneClickConfirmed, true);

      // Verify DB state updated
      const verifiedDose = (await db.collection('doseLogs').doc(testDoseId).get()).data();
      assert.equal(verifiedDose.status, 'Taken');

      // 5. Test browser GET request with Accept: text/html
      const anotherDoseId = `dose_browser_${Date.now()}`;
      await db.collection('doseLogs').doc(anotherDoseId).set({
        id: anotherDoseId,
        circleId,
        medicineName: 'Calcium Citrate',
        strength: '250mg',
        scheduledDate: '2026-11-15',
        scheduledTime: '12:00',
        status: 'Missed'
      });
      const browserToken = generateOneClickToken({
        doseId: anotherDoseId,
        circleId,
        action: 'Taken',
        expiresInHours: 24
      });

      const browserRes = await request(app)
        .get(`/api/doses/one-click-confirm?token=${encodeURIComponent(browserToken)}`)
        .set('Accept', 'text/html');
      assert.equal(browserRes.status, 200);
      assert.match(browserRes.text, /Dose Confirmed Taken/i);
      assert.match(browserRes.text, /Calcium Citrate/i);
    }
  );

  await t.test(
    '4. Missed-Dose Escalation Timing: Staged delivery to Elder -> Caretaker -> Family',
    async () => {
      clearSentEmailsLog();
      const db = getDb();

      // Ensure member alert permissions are active
      await request(app)
        .put(`/api/circles/${circleId}/members/${caretakerUid}/permissions`)
        .set('Authorization', `Bearer ${elderToken}`)
        .send({ permissions: { canViewMedicines: true, alertMissedDoses: true } });

      await request(app)
        .put(`/api/circles/${circleId}/members/${familyUid}/permissions`)
        .set('Authorization', `Bearer ${elderToken}`)
        .send({ permissions: { canViewDoses: true, alertMissedDoses: true } });

      // Set escalation policy: Caretaker delay 15m, Family delay 30m
      await request(app)
        .put(`/api/circles/${circleId}/permissions`)
        .set('Authorization', `Bearer ${elderToken}`)
        .send({
          permissions: {
            caretakerCanReceiveMissedAlerts: true,
            familyCanReceiveMissedAlerts: true
          },
          caretakerEscalationDelayMinutes: 15,
          familyEscalationDelayMinutes: 30
        });

      // Create overdue dose: scheduled for 09:00, grace 60 mins -> overdue at 10:00
      const escalationDoseId = `dose_escalate_${Date.now()}`;
      const todayStr = new Date().toISOString().split('T')[0];

      await db.collection('doseLogs').doc(escalationDoseId).set({
        id: escalationDoseId,
        circleId,
        medicineName: 'Metoprolol Tartrate',
        strength: '25mg',
        scheduledDate: todayStr,
        scheduledTime: '09:00',
        status: 'Pending',
        reminderSent: true
      });

      // --- STAGE 1: Cron runs at 10:05 (5 mins past grace expiration) ---
      // Only Elder should receive Tier 1 reminder with one-click URL
      const timeStage1 = new Date();
      timeStage1.setHours(10, 5, 0, 0);

      const cronStage1 = await request(app)
        .post('/api/cron/reminders')
        .set('x-cron-secret', config.cronSecret)
        .send({ circleId, referenceDate: timeStage1.toISOString() });
      assert.equal(cronStage1.status, 200);

      const emailsStage1 = getSentEmailsLog().filter((e) =>
        e.subject.includes('Metoprolol Tartrate')
      );
      assert.equal(emailsStage1.length, 1, 'Only Elder receives Tier 1 alert at 5 mins overdue');
      assert.equal(emailsStage1[0].to, elderEmail);
      assert.match(
        emailsStage1[0].text,
        /one-click-confirm\?token=/i,
        'Elder email must contain one-click confirmation link'
      );

      // Dose in DB has tier 1 recorded
      const doseAfterStage1 = (await db.collection('doseLogs').doc(escalationDoseId).get()).data();
      assert.equal(doseAfterStage1.status, 'Missed');
      assert.equal(doseAfterStage1.escalationTier, 1);
      assert.ok(doseAfterStage1.tier1SentAt);

      // --- STAGE 2: Cron runs at 10:18 (18 mins past grace expiration -> past 15 min caretaker delay) ---
      // Caretaker should receive Tier 2 escalation
      clearSentEmailsLog();
      const timeStage2 = new Date();
      timeStage2.setHours(10, 18, 0, 0);

      const cronStage2 = await request(app)
        .post('/api/cron/reminders')
        .set('x-cron-secret', config.cronSecret)
        .send({ circleId, referenceDate: timeStage2.toISOString() });
      assert.equal(cronStage2.status, 200);

      const emailsStage2 = getSentEmailsLog().filter((e) =>
        e.subject.includes('Metoprolol Tartrate')
      );
      assert.equal(emailsStage2.length, 1, 'Caretaker receives Tier 2 escalation');
      assert.equal(emailsStage2[0].to, caretakerEmail);
      assert.match(emailsStage2[0].text, /Escalation Tier 2/i);

      const doseAfterStage2 = (await db.collection('doseLogs').doc(escalationDoseId).get()).data();
      assert.equal(doseAfterStage2.escalationTier, 2);
      assert.ok(doseAfterStage2.tier2SentAt);

      // --- STAGE 3: Cron runs at 10:35 (35 mins past grace expiration -> past 30 min family delay) ---
      // Family member should receive Tier 3 escalation
      clearSentEmailsLog();
      const timeStage3 = new Date();
      timeStage3.setHours(10, 35, 0, 0);

      const cronStage3 = await request(app)
        .post('/api/cron/reminders')
        .set('x-cron-secret', config.cronSecret)
        .send({ circleId, referenceDate: timeStage3.toISOString() });
      assert.equal(cronStage3.status, 200);

      const emailsStage3 = getSentEmailsLog().filter((e) =>
        e.subject.includes('Metoprolol Tartrate')
      );
      assert.equal(emailsStage3.length, 1, 'Family receives Tier 3 escalation');
      assert.equal(emailsStage3[0].to, familyEmail);
      assert.match(emailsStage3[0].text, /Escalation Tier 3/i);

      const doseAfterStage3 = (await db.collection('doseLogs').doc(escalationDoseId).get()).data();
      assert.equal(doseAfterStage3.escalationTier, 3);
      assert.ok(doseAfterStage3.tier3SentAt);

      // --- STAGE 4: Duplicate Prevention check ---
      // Subsequent cron run at 10:45 should send ZERO emails for this dose
      clearSentEmailsLog();
      const timeStage4 = new Date();
      timeStage4.setHours(10, 45, 0, 0);

      await request(app)
        .post('/api/cron/reminders')
        .set('x-cron-secret', config.cronSecret)
        .send({ circleId, referenceDate: timeStage4.toISOString() });

      const emailsStage4 = getSentEmailsLog().filter((e) =>
        e.subject.includes('Metoprolol Tartrate')
      );
      assert.equal(emailsStage4.length, 0, 'No duplicate emails sent once all tiers executed');
    }
  );

  await t.test('5. Activity Log: Chronological audit feed records who changed what', async () => {
    const actLogRes = await request(app)
      .get(`/api/circles/${circleId}/activity-log`)
      .set('Authorization', `Bearer ${elderToken}`);

    assert.equal(actLogRes.status, 200);
    assert.ok(Array.isArray(actLogRes.body.logs));
    assert.ok(
      actLogRes.body.logs.length >= 3,
      'Activity log records member changes, permissions, and dose logs'
    );

    const actions = actLogRes.body.logs.map((l) => l.action);
    assert.ok(actions.includes('MEMBER_PERMISSIONS_UPDATED'));
    assert.ok(actions.includes('MEMBER_REVOKED'));
    assert.ok(actions.includes('MEMBER_RESTORED'));

    // Check chronological order (newest first)
    const logs = actLogRes.body.logs;
    for (let i = 0; i < logs.length - 1; i++) {
      assert.ok(
        new Date(logs[i].timestamp).getTime() >= new Date(logs[i + 1].timestamp).getTime(),
        'Activity logs must be sorted chronologically descending'
      );
    }
  });

  await t.test(
    '6. Dose pre-marked as Missed 90 minutes ago still triggers caretaker escalation',
    async () => {
      clearSentEmailsLog();
      const db = getDb();

      // Now reference time: 11:30 AM
      const nowTime = new Date();
      nowTime.setHours(11, 30, 0, 0);
      const todayStr = nowTime.toISOString().split('T')[0];

      // Dose scheduled for 09:00, marked Missed 90 minutes ago (at 10:00 AM) with Tier 1 sent
      const preMissedDoseId = `dose_premissed_${Date.now()}`;
      const missedTime = new Date(nowTime.getTime() - 90 * 60 * 1000); // 10:00 AM

      await db.collection('doseLogs').doc(preMissedDoseId).set({
        id: preMissedDoseId,
        circleId,
        medicineName: 'Atorvastatin Calcium',
        strength: '20mg',
        scheduledDate: todayStr,
        scheduledTime: '09:00',
        status: 'Missed',
        missedReason: 'Manually logged as missed by patient',
        tier1SentAt: missedTime.toISOString(),
        escalationTier: 1,
        missedAlertSent: true,
        missedAlertSentAt: missedTime.toISOString()
      });

      // Run cron at 11:30 AM (90 mins after Tier 1 -> exceeds 15-minute caretaker delay)
      const cronRes = await request(app)
        .post('/api/cron/reminders')
        .set('x-cron-secret', config.cronSecret)
        .send({ circleId, referenceDate: nowTime.toISOString() });

      assert.equal(cronRes.status, 200);

      // Verify Caretaker received escalation
      const sent = getSentEmailsLog();
      const caretakerMails = sent.filter(
        (e) => e.to === caretakerEmail && e.subject.includes('Atorvastatin Calcium')
      );
      assert.ok(
        caretakerMails.length >= 1,
        'Caretaker must receive escalation email for dose marked Missed 90m ago'
      );
      assert.match(caretakerMails[0].text, /Escalation Tier 2/i);

      // Verify dose updated with tier 2 sent in DB
      const updatedDose = (await db.collection('doseLogs').doc(preMissedDoseId).get()).data();
      assert.ok(updatedDose.escalationTier >= 2);
      assert.ok(updatedDose.tier2SentAt);
    }
  );
});
