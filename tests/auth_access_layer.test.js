import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../server/app.js';

test('Authentication & Access Layer Security Suite', async (t) => {
  let elderTokenCircleA = '';
  let circleAId = '';
  let userTokenCircleB = '';
  let circleBId = '';
  let familyTokenCircleA = '';

  await t.test('Setup: Create Circle A and Circle B with different owners', async () => {
    // 1. Elder for Circle A
    const elderRes = await request(app).post('/api/auth/register').send({
      email: 'elder.a@example.com',
      password: 'password123',
      name: 'Elder Alice',
      role: 'elder'
    });
    assert.equal(elderRes.status, 201);
    elderTokenCircleA = elderRes.body.token;

    const createCircleARes = await request(app)
      .post('/api/circles/create')
      .set('Authorization', `Bearer ${elderTokenCircleA}`)
      .send({
        name: 'Circle Alpha',
        elderName: 'Alice Alpha',
        passcode: 'SecretPassA'
      });
    assert.equal(createCircleARes.status, 201);
    circleAId = createCircleARes.body.circle.id;

    // 2. Elder for Circle B (Disjoint Circle)
    const elderBRes = await request(app).post('/api/auth/register').send({
      email: 'elder.b@example.com',
      password: 'password123',
      name: 'Elder Bob',
      role: 'elder'
    });
    assert.equal(elderBRes.status, 201);
    userTokenCircleB = elderBRes.body.token;

    const createCircleBRes = await request(app)
      .post('/api/circles/create')
      .set('Authorization', `Bearer ${userTokenCircleB}`)
      .send({
        name: 'Circle Beta',
        elderName: 'Bob Beta',
        passcode: 'SecretPassB'
      });
    assert.equal(createCircleBRes.status, 201);
    circleBId = createCircleBRes.body.circle.id;

    // 3. Family member for Circle A
    const famRes = await request(app).post('/api/auth/register').send({
      email: 'family.member@example.com',
      password: 'password123',
      name: 'Charlie Family',
      role: 'family'
    });
    assert.equal(famRes.status, 201);
    familyTokenCircleA = famRes.body.token;

    // Join Circle A as family
    const joinRes = await request(app)
      .post('/api/circles/join')
      .set('Authorization', `Bearer ${familyTokenCircleA}`)
      .send({
        circleId: circleAId,
        passcode: 'SecretPassA',
        role: 'family'
      });
    assert.equal(joinRes.status, 200);
  });

  // TEST 1: Token required
  await t.test('1. Token required: unauthenticated request is rejected with 401', async () => {
    // Request without Authorization header
    const noTokenRes = await request(app)
      .get(`/api/circles/${circleAId}`);
    assert.equal(noTokenRes.status, 401);
    assert.equal(noTokenRes.body.success, false);
    assert.match(noTokenRes.body.error, /Authentication required/);

    // Request with invalid token
    const invalidTokenRes = await request(app)
      .get(`/api/circles/${circleAId}`)
      .set('Authorization', 'Bearer invalid.bogus.jwt.token');
    assert.equal(invalidTokenRes.status, 401);
    assert.equal(invalidTokenRes.body.success, false);
    assert.match(invalidTokenRes.body.error, /Invalid or expired/);
  });

  // TEST 2: Wrong passcode rejected
  await t.test('2. Wrong passcode rejected: joining with incorrect passcode returns 401', async () => {
    // Fresh user tries to join Circle A with wrong passcode
    const intruderRes = await request(app).post('/api/auth/register').send({
      email: 'intruder@example.com',
      password: 'password123',
      name: 'Intruder'
    });
    const intruderToken = intruderRes.body.token;

    const wrongPassRes = await request(app)
      .post('/api/circles/join')
      .set('Authorization', `Bearer ${intruderToken}`)
      .send({
        circleId: circleAId,
        passcode: 'DefinitivelyWrongPasscode999',
        role: 'family'
      });

    assert.equal(wrongPassRes.status, 401);
    assert.equal(wrongPassRes.body.success, false);
    assert.match(wrongPassRes.body.error, /Incorrect passcode/);
  });

  // TEST 3: Rate limit works
  await t.test('3. Rate limit works: excessive passcode join attempts are blocked with 429', async () => {
    const testerRes = await request(app).post('/api/auth/register').send({
      email: 'ratelimit.tester@example.com',
      password: 'password123',
      name: 'Rate Limit Tester'
    });
    const token = testerRes.body.token;

    // Send rapid join attempts to exceed the 5-attempt window
    const results = [];
    for (let i = 0; i < 7; i++) {
      const res = await request(app)
        .post('/api/circles/join')
        .set('Authorization', `Bearer ${token}`)
        .send({
          circleId: circleAId,
          passcode: `attempt_${i}`,
          role: 'family'
        });
      results.push(res.status);
    }

    // At least the later attempts should be rate limited with HTTP 429
    assert.ok(results.includes(429), `Expected HTTP 429 in results, got: ${JSON.stringify(results)}`);
  });

  // TEST 4: Family member cannot do caretaker-only actions
  await t.test('4. Family member cannot do caretaker-only actions: adding medication rejected with 403', async () => {
    // Family member attempts to add a medication to Circle A
    const addMedRes = await request(app)
      .post('/api/medications')
      .set('Authorization', `Bearer ${familyTokenCircleA}`)
      .send({
        circleId: circleAId,
        name: 'Aspirin Cardio',
        dosage: '100mg',
        schedules: ['08:00'],
        sourceLabel: 'From the packaging'
      });

    assert.equal(addMedRes.status, 403);
    assert.equal(addMedRes.body.success, false);
    assert.match(addMedRes.body.error, /Permission denied/);
  });

  // TEST 5: User from another circle cannot read this circle's data
  await t.test('5. Cross-circle boundary: user from Circle B cannot read Circle A data', async () => {
    // Bob (from Circle B) attempts to read Circle A details
    const crossCircleRead = await request(app)
      .get(`/api/circles/${circleAId}`)
      .set('Authorization', `Bearer ${userTokenCircleB}`);

    assert.equal(crossCircleRead.status, 403);
    assert.equal(crossCircleRead.body.success, false);
    assert.match(crossCircleRead.body.error, /Access denied: You are not a registered member/);

    // Bob attempts to query Circle A medications
    const crossCircleMeds = await request(app)
      .get(`/api/medications?circleId=${circleAId}`)
      .set('Authorization', `Bearer ${userTokenCircleB}`);

    assert.equal(crossCircleMeds.status, 403);
    assert.equal(crossCircleMeds.body.success, false);
  });
});
