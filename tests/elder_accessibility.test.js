import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../server/app.js';

test('Elder-First Accessibility & Settings Persistence Suite', async (t) => {
  let userToken = '';

  await t.test('Setup: Create test account', async () => {
    const regRes = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Savitri Devi',
        email: `savitri_${Date.now()}@carecircle.demo`,
        password: 'securePassword123',
        role: 'elder'
      });

    assert.equal(regRes.status, 201);
    userToken = regRes.body.token;
    assert.ok(regRes.body.user.uid);
  });

  await t.test('1. Unauthenticated requests to preferences are rejected with 401', async () => {
    const res = await request(app).get('/api/auth/preferences');
    assert.equal(res.status, 401);
  });

  await t.test('2. Default preferences returned for fresh account', async () => {
    const res = await request(app)
      .get('/api/auth/preferences')
      .set('Authorization', `Bearer ${userToken}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.preferences);
    assert.equal(res.body.preferences.fontSize, 'normal');
    assert.equal(res.body.preferences.highContrast, false);
    assert.equal(res.body.preferences.reduceMotion, false);
  });

  await t.test('3. Settings Validation: Rejects invalid font sizes', async () => {
    const resInvalidFont = await request(app)
      .put('/api/auth/preferences')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        preferences: {
          fontSize: 'gigantic_unsupported_size'
        }
      });

    assert.equal(resInvalidFont.status, 400);
    assert.match(resInvalidFont.body.error, /Invalid fontSize/i);
  });

  await t.test(
    '4. Settings Persistence: Validates and persists all 5 accessibility settings',
    async () => {
      const updateRes = await request(app)
        .put('/api/auth/preferences')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          preferences: {
            fontSize: 'xlarge',
            highContrast: true,
            reduceMotion: true,
            voiceEnabled: true,
            elderSimpleMode: true
          }
        });

      assert.equal(updateRes.status, 200);
      assert.equal(updateRes.body.success, true);
      assert.equal(updateRes.body.preferences.fontSize, 'xlarge');
      assert.equal(updateRes.body.preferences.highContrast, true);
      assert.equal(updateRes.body.preferences.reduceMotion, true);
      assert.equal(updateRes.body.preferences.voiceEnabled, true);
      assert.equal(updateRes.body.preferences.elderSimpleMode, true);

      // Verify persistence on subsequent GET
      const fetchRes = await request(app)
        .get('/api/auth/preferences')
        .set('Authorization', `Bearer ${userToken}`);

      assert.equal(fetchRes.status, 200);
      assert.equal(fetchRes.body.preferences.fontSize, 'xlarge');
      assert.equal(fetchRes.body.preferences.highContrast, true);
      assert.equal(fetchRes.body.preferences.reduceMotion, true);
      assert.equal(fetchRes.body.preferences.voiceEnabled, true);
      assert.equal(fetchRes.body.preferences.elderSimpleMode, true);
    }
  );

  await t.test('5. Large text level validation (supports normal, large, xlarge)', async () => {
    for (const size of ['normal', 'large', 'xlarge']) {
      const res = await request(app)
        .put('/api/auth/preferences')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          preferences: { fontSize: size }
        });
      assert.equal(res.status, 200);
      assert.equal(res.body.preferences.fontSize, size);
    }
  });
});
