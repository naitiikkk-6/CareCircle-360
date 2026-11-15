import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../server/app.js';

test('MediGuide AI Packaging Safety & Health Guardian Simulation', async (t) => {
  let token = '';
  let circleId = '';

  await t.test('Setup: Create authenticated circle', async () => {
    const authRes = await request(app).post('/api/auth/demo-login').send({ persona: 'elder' });
    token = authRes.body.token;

    const circleRes = await request(app)
      .post('/api/circles/create')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'AI Safety Circle',
        elderName: 'Safety Elder',
        passcode: 'aiPass123'
      });
    circleId = circleRes.body.circle.id;
  });

  await t.test(
    '1. MediGuide AI scanner extracts packaging text and enforces source labeling',
    async () => {
      const samplePackagingText = `
      Paracetamol Tablets IP
      Strength: 500mg
      Take with water after food
      Batch No: PX9921 Exp: 05/2027
    `;

      const res = await request(app)
        .post('/api/ai/scan-packaging')
        .set('Authorization', `Bearer ${token}`)
        .send({ packagingText: samplePackagingText });

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      const analysis = res.body.analysis;

      // Strict safety rules verification
      assert.ok(analysis.medicineName);
      assert.equal(analysis.requiresUserConfirmation, true);
      assert.ok(analysis.safetyWarning);
      assert.match(analysis.safetyWarning, /CareCircle 360 AI Safety Protocol/);

      // Source labels MUST be either 'From the packaging' or 'Not verified - ask your pharmacist or doctor'
      const allowedLabels = ['From the packaging', 'Not verified - ask your pharmacist or doctor'];
      assert.ok(allowedLabels.includes(analysis.medicineNameSource));
      assert.ok(allowedLabels.includes(analysis.strengthSource));
      assert.ok(allowedLabels.includes(analysis.instructionsSource));
      assert.ok(allowedLabels.includes(analysis.foodNoticeSource));
    }
  );

  await t.test(
    '2. Health Guardian returns simulated vitals with mandatory simulation disclaimer',
    async () => {
      const res = await request(app)
        .get(`/api/guardian/vitals?circleId=${circleId}`)
        .set('Authorization', `Bearer ${token}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.isSimulated, true);
      assert.ok(res.body.disclaimer);
      assert.match(res.body.disclaimer, /SIMULATED DEMO READINGS/);
      assert.ok(res.body.readings.length >= 7);
    }
  );

  await t.test(
    '3. Health Guardian allows adding simulated data point explicitly labelled as simulated',
    async () => {
      const res = await request(app)
        .post('/api/guardian/simulate-reading')
        .set('Authorization', `Bearer ${token}`)
        .send({
          circleId,
          systolic: 122,
          diastolic: 82,
          heartRate: 75
        });

      assert.equal(res.status, 201);
      assert.equal(res.body.success, true);
      assert.equal(res.body.reading.isSimulated, true);
      assert.equal(res.body.reading.bloodPressureSystolic, 122);
    }
  );
});
