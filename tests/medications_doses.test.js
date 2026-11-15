import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../server/app.js';

test('Medications, Schedules, and Dose Tracking Logic', async (t) => {
  let token = '';
  let circleId = '';
  let doseId = '';

  await t.test('Setup: Create circle for medications testing', async () => {
    const authRes = await request(app).post('/api/auth/demo-login').send({ persona: 'elder' });
    token = authRes.body.token;

    const circleRes = await request(app)
      .post('/api/circles/create')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Meds Test Circle',
        elderName: 'Dose Elder',
        passcode: 'medPass123'
      });
    circleId = circleRes.body.circle.id;
  });

  await t.test('1. Should add medication with multiple schedules and verified source', async () => {
    const res = await request(app)
      .post('/api/medications')
      .set('Authorization', `Bearer ${token}`)
      .send({
        circleId,
        name: 'Metformin Hydrochloride',
        dosage: '500mg',
        packagingInstructions: 'Take with evening meal',
        sourceLabel: 'From the packaging',
        schedules: ['08:00', '20:00']
      });

    assert.equal(res.status, 201);
    assert.equal(res.body.success, true);
    assert.equal(res.body.medication.sourceLabel, 'From the packaging');
    assert.equal(res.body.medication.schedules.length, 2);
    assert.ok(res.body.medication.id);
  });

  await t.test('2. Should enforce safety label fallback for unverified medicine info', async () => {
    const res = await request(app)
      .post('/api/medications')
      .set('Authorization', `Bearer ${token}`)
      .send({
        circleId,
        name: 'Unknown Supplement',
        dosage: '1 capsule',
        sourceLabel: 'Arbitrary Unverified Web Text', // invalid source
        schedules: ['12:00']
      });

    assert.equal(res.status, 201);
    assert.equal(res.body.medication.sourceLabel, 'Not verified - ask your pharmacist or doctor');
  });

  await t.test('3. Should synchronize and retrieve doses for today', async () => {
    const res = await request(app)
      .get(`/api/doses?circleId=${circleId}`)
      .set('Authorization', `Bearer ${token}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.doses.length >= 3); // 2 from Metformin + 1 from Supplement
    assert.equal(res.body.doses[0].status, 'Pending');
    doseId = res.body.doses[0].id;
  });

  await t.test('4. Should log dose as Taken', async () => {
    const res = await request(app)
      .post('/api/doses/log')
      .set('Authorization', `Bearer ${token}`)
      .send({
        circleId,
        doseId,
        status: 'Taken',
        notes: 'Taken on time with warm water'
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.dose.status, 'Taken');
    assert.ok(res.body.dose.loggedAt);
    assert.equal(res.body.dose.loggedBy.name, 'Ramesh Sharma (Elder)');
  });

  await t.test('5. Should calculate accurate Daily Care Pulse summary', async () => {
    const res = await request(app)
      .get(`/api/doses/pulse?circleId=${circleId}`)
      .set('Authorization', `Bearer ${token}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.pulse.taken, 1);
    assert.equal(res.body.pulse.adherenceRate, 100); // 1 taken out of 1 evaluated
  });
});
