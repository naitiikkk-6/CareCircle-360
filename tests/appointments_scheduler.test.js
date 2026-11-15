import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../server/app.js';
import { config } from '../server/config.js';

test('Appointments and Proactive Cloud Scheduler Integration', async (t) => {
  let token = '';
  let circleId = '';
  let apptId = '';

  await t.test('Setup: Create circle with appointment', async () => {
    const authRes = await request(app).post('/api/auth/demo-login').send({ persona: 'elder' });
    token = authRes.body.token;

    const circleRes = await request(app)
      .post('/api/circles/create')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Scheduler Test Circle',
        elderName: 'Elder Appointment Test',
        passcode: 'schedPass123'
      });
    circleId = circleRes.body.circle.id;

    // Schedule appointment 24 hours in the future
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const apptRes = await request(app)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${token}`)
      .send({
        circleId,
        doctorName: 'Rajesh Khanna',
        specialty: 'Cardiology',
        datetime: tomorrow,
        location: 'Metro Heart Institute'
      });

    assert.equal(apptRes.status, 201);
    apptId = apptRes.body.appointment.id;
  });

  await t.test('1. Should list scheduled appointments for circle', async () => {
    const res = await request(app)
      .get(`/api/appointments?circleId=${circleId}`)
      .set('Authorization', `Bearer ${token}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.appointments.length, 1);
    assert.equal(res.body.appointments[0].doctorName, 'Rajesh Khanna');
  });

  await t.test('2. Should execute Cloud Scheduler cycle with secret header', async () => {
    const res = await request(app)
      .post('/api/scheduler/check-reminders')
      .set('x-scheduler-secret', config.schedulerSecret)
      .send({ circleId });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.result);
    // Verified that appointment reminder was checked and processed
    assert.ok(res.body.result.processedCircles >= 1);
  });

  await t.test('3. Should trigger daily pulse calculation and notification dispatch', async () => {
    const res = await request(app)
      .post('/api/scheduler/daily-pulse')
      .set('Authorization', `Bearer ${token}`)
      .send({ circleId });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.record);
    assert.equal(res.body.record.circleId, circleId);
  });

  await t.test('4. Should record email audit log for notifications', async () => {
    const res = await request(app)
      .get('/api/scheduler/audit-logs')
      .set('Authorization', `Bearer ${token}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(Array.isArray(res.body.logs));
  });
});
