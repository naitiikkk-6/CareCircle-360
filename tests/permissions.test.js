import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../server/app.js';

test('Server-Side Elder Permissions Matrix', async (t) => {
  let elderToken = '';
  let familyToken = '';
  let circleId = '';

  await t.test('Setup: Provision Elder and Family member in circle', async () => {
    // 1. Elder
    const elderRes = await request(app).post('/api/auth/demo-login').send({ persona: 'elder' });
    elderToken = elderRes.body.token;

    // Create circle
    const circleRes = await request(app)
      .post('/api/circles/create')
      .set('Authorization', `Bearer ${elderToken}`)
      .send({
        name: 'Permission Test Circle',
        elderName: 'Elder Owner',
        passcode: 'testPass1'
      });
    circleId = circleRes.body.circle.id;

    // 2. Family member
    const familyRes = await request(app).post('/api/auth/demo-login').send({ persona: 'family' });
    familyToken = familyRes.body.token;

    // Join circle as family
    await request(app)
      .post('/api/circles/join')
      .set('Authorization', `Bearer ${familyToken}`)
      .send({
        circleId,
        passcode: 'testPass1',
        role: 'family'
      });
  });

  await t.test(
    '1. Family should be BLOCKED from adding medication by default (Elder-controlled)',
    async () => {
      const res = await request(app)
        .post('/api/medications')
        .set('Authorization', `Bearer ${familyToken}`)
        .send({
          circleId,
          name: 'Aspirin',
          dosage: '75mg',
          schedules: ['09:00']
        });

      assert.equal(res.status, 403);
      assert.equal(res.body.success, false);
      assert.match(res.body.error, /Permission denied/);
    }
  );

  await t.test('2. Non-elder (Family) cannot modify circle permissions', async () => {
    const res = await request(app)
      .put(`/api/circles/${circleId}/permissions`)
      .set('Authorization', `Bearer ${familyToken}`)
      .send({
        permissions: { familyCanManageMeds: true }
      });

    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
  });

  await t.test('3. Elder grants Family permission to manage medications', async () => {
    const res = await request(app)
      .put(`/api/circles/${circleId}/permissions`)
      .set('Authorization', `Bearer ${elderToken}`)
      .send({
        permissions: {
          caretakerCanManageMeds: true,
          caretakerCanLogDoses: true,
          caretakerCanManageAppointments: true,
          familyCanManageMeds: true,
          familyCanLogDoses: true
        }
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.permissions.familyCanManageMeds, true);
  });

  await t.test(
    '4. Family member can now add medication after explicit Elder authorization',
    async () => {
      const res = await request(app)
        .post('/api/medications')
        .set('Authorization', `Bearer ${familyToken}`)
        .send({
          circleId,
          name: 'Aspirin',
          dosage: '75mg',
          schedules: ['09:00'],
          sourceLabel: 'From the packaging'
        });

      assert.equal(res.status, 201);
      assert.equal(res.body.success, true);
      assert.equal(res.body.medication.name, 'Aspirin');
    }
  );
});
