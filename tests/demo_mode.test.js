import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../server/app.js';
import { DEMO_CIRCLE_ID, DEMO_PASSCODE } from '../server/services/seedService.js';

test('Demo Mode & Seeded Fake Care Circle Suite', async (t) => {
  await t.test(
    '1. GET /api/auth/demo-info provides transparent evaluator info with no real patient data',
    async () => {
      const res = await request(app).get('/api/auth/demo-info');
      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.ok(res.body.circle);
      assert.equal(res.body.circle.id, DEMO_CIRCLE_ID);
      assert.equal(res.body.circle.passcode, DEMO_PASSCODE);
      assert.match(res.body.disclaimer, /NO REAL PATIENT DATA/i);
      assert.ok(res.body.personas.elder);
      assert.ok(res.body.personas.caretaker);
      assert.ok(res.body.personas.family);
    }
  );

  await t.test('2. One-click demo login for Elder, Caretaker, and Family roles', async () => {
    // Elder
    const elderRes = await request(app).post('/api/auth/demo-login').send({ persona: 'elder' });
    assert.equal(elderRes.status, 200);
    assert.equal(elderRes.body.user.role, 'elder');
    assert.equal(elderRes.body.isDemo, true);
    const elderToken = elderRes.body.token;

    // Verify elder has access to seeded demo circle
    const elderCircleRes = await request(app)
      .get(`/api/circles/${DEMO_CIRCLE_ID}`)
      .set('Authorization', `Bearer ${elderToken}`);
    assert.equal(elderCircleRes.status, 200);
    assert.equal(elderCircleRes.body.isElder, true);
    assert.equal(elderCircleRes.body.userRole, 'elder');

    // Caretaker
    const caretakerRes = await request(app)
      .post('/api/auth/demo-login')
      .send({ persona: 'caretaker' });
    assert.equal(caretakerRes.status, 200);
    assert.equal(caretakerRes.body.user.role, 'caretaker');
    const caretakerToken = caretakerRes.body.token;

    const caretakerCircleRes = await request(app)
      .get(`/api/circles/${DEMO_CIRCLE_ID}`)
      .set('Authorization', `Bearer ${caretakerToken}`);
    assert.equal(caretakerCircleRes.status, 200);
    assert.equal(caretakerCircleRes.body.userRole, 'caretaker');

    // Family
    const familyRes = await request(app).post('/api/auth/demo-login').send({ persona: 'family' });
    assert.equal(familyRes.status, 200);
    assert.equal(familyRes.body.user.role, 'family');
    const familyToken = familyRes.body.token;

    const familyCircleRes = await request(app)
      .get(`/api/circles/${DEMO_CIRCLE_ID}`)
      .set('Authorization', `Bearer ${familyToken}`);
    assert.equal(familyCircleRes.status, 200);
    assert.equal(familyCircleRes.body.userRole, 'family');
  });

  await t.test('3. Manual credential login using seeded fake accounts', async () => {
    const loginRes = await request(app).post('/api/auth/login').send({
      email: 'ramesh.elder@carecircle.demo',
      password: 'demoPass123'
    });
    assert.equal(loginRes.status, 200);
    assert.equal(loginRes.body.success, true);
    assert.ok(loginRes.body.token);
  });

  await t.test(
    '4. Seeded circle contains fake medications, doses, and appointments clearly labelled',
    async () => {
      const loginRes = await request(app).post('/api/auth/demo-login').send({ persona: 'elder' });
      const token = loginRes.body.token;

      // Check Medications
      const medsRes = await request(app)
        .get(`/api/medications?circleId=${DEMO_CIRCLE_ID}`)
        .set('Authorization', `Bearer ${token}`);
      assert.equal(medsRes.status, 200);
      assert.ok(medsRes.body.medications.length >= 3);
      assert.match(medsRes.body.medications[0].name, /\[DEMO\]/);

      // Check Appointments
      const apptsRes = await request(app)
        .get(`/api/appointments?circleId=${DEMO_CIRCLE_ID}`)
        .set('Authorization', `Bearer ${token}`);
      assert.equal(apptsRes.status, 200);
      assert.ok(apptsRes.body.appointments.length >= 2);
      assert.match(apptsRes.body.appointments[0].doctorName, /\[DEMO\]/);

      // Check Doses
      const dosesRes = await request(app)
        .get(`/api/doses?circleId=${DEMO_CIRCLE_ID}`)
        .set('Authorization', `Bearer ${token}`);
      assert.equal(dosesRes.status, 200);
      assert.ok(dosesRes.body.doses.length >= 3);
    }
  );

  await t.test('5. POST /api/auth/reset-demo resets the fake circle to default state', async () => {
    const resetRes = await request(app).post('/api/auth/reset-demo');
    assert.equal(resetRes.status, 200);
    assert.equal(resetRes.body.success, true);
    assert.equal(resetRes.body.circleId, DEMO_CIRCLE_ID);
  });
});
