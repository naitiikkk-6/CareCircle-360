import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../server/app.js';
import { getDb } from '../server/db.js';
import {
  evaluateGraceWindowForMissedDoses,
  calculateAdherenceForRange
} from '../server/services/doseService.js';

test('Dose Tracking: Status Transitions, Grace Window Boundaries, and Adherence', async (t) => {
  let elderToken = '';
  let circleId = '';
  let circleObj = null;

  await t.test('Setup: Create authenticated circle', async () => {
    const elderRes = await request(app).post('/api/auth/demo-login').send({ persona: 'elder' });
    elderToken = elderRes.body.token;

    const circleRes = await request(app)
      .post('/api/circles/create')
      .set('Authorization', `Bearer ${elderToken}`)
      .send({
        name: 'Dose Tracking Test Circle',
        elderName: 'Elder Tracking',
        passcode: 'doseSecret123',
        timezone: 'Asia/Kolkata'
      });
    assert.equal(circleRes.status, 201);
    circleId = circleRes.body.circle.id;
    circleObj = circleRes.body.circle;
  });

  // TEST 1: Status Transitions
  await t.test(
    '1. Status transitions: Pending -> Taken, Pending -> Missed with audit metadata',
    async () => {
      const db = getDb();
      const doseId = `dose_transition_${Date.now()}`;
      const todayStr = '2026-11-15';

      await db.collection('doseLogs').doc(doseId).set({
        id: doseId,
        circleId,
        medicineName: 'Amlodipine',
        strength: '5mg',
        scheduledDate: todayStr,
        scheduledTime: '08:00',
        status: 'Pending',
        createdAt: new Date().toISOString()
      });

      // Mark as Taken
      const takeRes = await request(app)
        .post('/api/doses/log')
        .set('Authorization', `Bearer ${elderToken}`)
        .send({
          circleId,
          doseId,
          status: 'Taken',
          notes: 'Taken with warm water'
        });

      assert.equal(takeRes.status, 200);
      assert.equal(takeRes.body.dose.status, 'Taken');
      assert.ok(takeRes.body.dose.loggedAt);
      assert.equal(takeRes.body.dose.loggedBy.name, 'Ramesh Sharma (Elder)');
      assert.equal(takeRes.body.dose.notes, 'Taken with warm water');

      // Transition back to Missed
      const missRes = await request(app)
        .post('/api/doses/log')
        .set('Authorization', `Bearer ${elderToken}`)
        .send({
          circleId,
          doseId,
          status: 'Missed',
          missedReason: 'Patient was away for morning walk'
        });

      assert.equal(missRes.status, 200);
      assert.equal(missRes.body.dose.status, 'Missed');
      assert.equal(missRes.body.dose.missedReason, 'Patient was away for morning walk');
    }
  );

  // TEST 2: Grace Window Boundaries
  await t.test(
    '2. Grace window boundaries: 59 mins past remains Pending; 61 mins past marks Missed',
    async () => {
      const db = getDb();
      const todayStr = '2026-11-15';

      // Dose scheduled for 10:00
      const doseWithinGraceId = `dose_grace_within_${Date.now()}`;
      await db.collection('doseLogs').doc(doseWithinGraceId).set({
        id: doseWithinGraceId,
        circleId,
        medicineName: 'Calcium Carbonate',
        strength: '500mg',
        scheduledDate: todayStr,
        scheduledTime: '10:00',
        status: 'Pending',
        createdAt: new Date().toISOString()
      });

      // Subtest A: At 10:59 AM (59 minutes past scheduled time).
      // Configurable grace window is 60 minutes.
      // 59 <= 60 -> Must remain Pending!
      const timeAt1059 = new Date('2026-11-15T10:59:00+05:30');
      const withinResult = await evaluateGraceWindowForMissedDoses({
        circle: circleObj,
        graceWindowMinutes: 60,
        referenceDateObj: timeAt1059
      });

      const docWithin = await db.collection('doseLogs').doc(doseWithinGraceId).get();
      assert.equal(
        docWithin.data().status,
        'Pending',
        'Dose at 59 mins overdue should remain Pending'
      );
      assert.ok(!withinResult.missedDoses.includes(doseWithinGraceId));

      // Subtest B: At 11:01 AM (61 minutes past scheduled time).
      // 61 > 60 -> Exceeded grace window -> Must automatically transition to Missed!
      const timeAt1101 = new Date('2026-11-15T11:01:00+05:30');
      const expiredResult = await evaluateGraceWindowForMissedDoses({
        circle: circleObj,
        graceWindowMinutes: 60,
        referenceDateObj: timeAt1101
      });

      const docExpired = await db.collection('doseLogs').doc(doseWithinGraceId).get();
      assert.equal(
        docExpired.data().status,
        'Missed',
        'Dose at 61 mins overdue should be marked Missed'
      );
      assert.ok(expiredResult.missedDoses.includes(doseWithinGraceId));
      assert.equal(docExpired.data().loggedBy.role, 'system');
    }
  );

  // TEST 3: Already Taken dose is NOT turned into Missed
  await t.test(
    '3. Safety constraint: An already Taken dose is NEVER turned into Missed by grace evaluation',
    async () => {
      const db = getDb();
      const todayStr = '2026-11-15';
      const takenDoseId = `dose_already_taken_${Date.now()}`;

      // Scheduled at 08:00 and marked Taken
      await db
        .collection('doseLogs')
        .doc(takenDoseId)
        .set({
          id: takenDoseId,
          circleId,
          medicineName: 'Levothyroxine',
          strength: '50mcg',
          scheduledDate: todayStr,
          scheduledTime: '08:00',
          status: 'Taken',
          loggedAt: '2026-11-15T08:05:00+05:30',
          loggedBy: { name: 'Elder Tracking', role: 'elder' },
          createdAt: new Date().toISOString()
        });

      // Run grace window at 16:00 (8 hours past scheduled time)
      const timeAt1600 = new Date('2026-11-15T16:00:00+05:30');
      const result = await evaluateGraceWindowForMissedDoses({
        circle: circleObj,
        graceWindowMinutes: 60,
        referenceDateObj: timeAt1600
      });

      const docAfterGrace = await db.collection('doseLogs').doc(takenDoseId).get();
      assert.equal(docAfterGrace.data().status, 'Taken', 'Taken dose must remain Taken');
      assert.ok(!result.missedDoses.includes(takenDoseId));
      assert.ok(result.skippedTakenCount >= 1);
    }
  );

  // TEST 4: Adherence Calculation (Ignoring Future Doses)
  await t.test(
    '4. Adherence calculation: taken / total due, strictly ignoring future doses',
    async () => {
      const db = getDb();
      const adherCircleId = 'circle_adherence_calc_' + Date.now();
      const testCircle = { id: adherCircleId, timezone: 'Asia/Kolkata' };
      const dateStr = '2026-11-15';

      // Dose 1: 08:00 AM -> Taken (Due in past)
      await db
        .collection('doseLogs')
        .doc(`${adherCircleId}_1`)
        .set({
          id: `${adherCircleId}_1`,
          circleId: adherCircleId,
          medicineName: 'Med 1',
          scheduledDate: dateStr,
          scheduledTime: '08:00',
          status: 'Taken'
        });

      // Dose 2: 10:00 AM -> Missed (Due in past)
      await db
        .collection('doseLogs')
        .doc(`${adherCircleId}_2`)
        .set({
          id: `${adherCircleId}_2`,
          circleId: adherCircleId,
          medicineName: 'Med 2',
          scheduledDate: dateStr,
          scheduledTime: '10:00',
          status: 'Missed'
        });

      // Dose 3: 18:00 PM -> Pending (FUTURE dose for this evening)
      await db
        .collection('doseLogs')
        .doc(`${adherCircleId}_3`)
        .set({
          id: `${adherCircleId}_3`,
          circleId: adherCircleId,
          medicineName: 'Med 3',
          scheduledDate: dateStr,
          scheduledTime: '18:00',
          status: 'Pending'
        });

      // Dose 4: 22:00 PM -> Pending (FUTURE dose for tonight)
      await db
        .collection('doseLogs')
        .doc(`${adherCircleId}_4`)
        .set({
          id: `${adherCircleId}_4`,
          circleId: adherCircleId,
          medicineName: 'Med 4',
          scheduledDate: dateStr,
          scheduledTime: '22:00',
          status: 'Pending'
        });

      // Reference time: 12:00 PM Noon (08:00 and 10:00 are past; 18:00 and 22:00 are future)
      const noonRef = new Date('2026-11-15T12:00:00+05:30');

      const adherenceResult = await calculateAdherenceForRange({
        circle: testCircle,
        startDate: dateStr,
        endDate: dateStr,
        referenceDateObj: noonRef
      });

      // Total Due MUST be 2 (1 taken + 1 missed). Future pending doses (2) must NOT be counted as due!
      assert.equal(adherenceResult.totalDue, 2);
      assert.equal(adherenceResult.takenCount, 1);
      assert.equal(adherenceResult.missedCount, 1);
      assert.equal(adherenceResult.futurePendingCount, 2);

      // Adherence = (1 / 2) * 100 = 50%
      assert.equal(adherenceResult.adherencePercentage, 50);
    }
  );

  // TEST 5: History View API Endpoint
  await t.test(
    '5. History endpoint: returns adherence percentage and missed doses list',
    async () => {
      const res = await request(app)
        .get(`/api/doses/history?circleId=${circleId}&days=30`)
        .set('Authorization', `Bearer ${elderToken}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.ok(typeof res.body.history.adherencePercentage === 'number');
      assert.ok(Array.isArray(res.body.history.missedDoses));
    }
  );
});
