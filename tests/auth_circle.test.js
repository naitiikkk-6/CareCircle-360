import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../server/app.js';

test('Auth and Care Circle Management', async (t) => {
  let elderToken = '';
  let caretakerToken = '';
  let circleId = '';

  await t.test('1. Should provision demo Elder account and return valid JWT', async () => {
    const res = await request(app)
      .post('/api/auth/demo-login')
      .send({ persona: 'elder' });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.token);
    assert.equal(res.body.user.uid, 'demo_elder_ramesh');
    elderToken = res.body.token;
  });

  await t.test('2. Should provision demo Caretaker account', async () => {
    const res = await request(app)
      .post('/api/auth/demo-login')
      .send({ persona: 'caretaker' });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    caretakerToken = res.body.token;
  });

  await t.test('3. Should create Care Circle with hashed passcode (Elder only)', async () => {
    const res = await request(app)
      .post('/api/circles/create')
      .set('Authorization', `Bearer ${elderToken}`)
      .send({
        name: 'Gupta Family Care',
        elderName: 'Nirmala Gupta',
        passcode: 'secretPass123'
      });

    assert.equal(res.status, 201);
    assert.equal(res.body.success, true);
    assert.ok(res.body.circle.id);
    // CRITICAL: Ensure plaintext passcode and passcodeHash are NEVER returned in response
    assert.equal(res.body.circle.passcode, undefined);
    assert.equal(res.body.circle.passcodeHash, undefined);
    circleId = res.body.circle.id;
  });

  await t.test('4. Should reject circle join with invalid passcode', async () => {
    const res = await request(app)
      .post('/api/circles/join')
      .set('Authorization', `Bearer ${caretakerToken}`)
      .send({
        circleId,
        passcode: 'wrongPassword',
        role: 'caretaker'
      });

    assert.equal(res.status, 401);
    assert.equal(res.body.success, false);
  });

  await t.test('5. Should successfully join circle with correct hashed passcode', async () => {
    const res = await request(app)
      .post('/api/circles/join')
      .set('Authorization', `Bearer ${caretakerToken}`)
      .send({
        circleId,
        passcode: 'secretPass123',
        role: 'caretaker'
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.circle.myRole, 'caretaker');
  });

  await t.test('6. Should retrieve circle details with role recognition', async () => {
    const res = await request(app)
      .get(`/api/circles/${circleId}`)
      .set('Authorization', `Bearer ${caretakerToken}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.userRole, 'caretaker');
    assert.equal(res.body.isElder, false);
    assert.equal(res.body.circle.passcodeHash, undefined);
  });
});
