import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../server/app.js';
import { getLocalDateInTimezone, getLocalDayOfWeekInTimezone } from '../server/services/doseService.js';

test('Medicine Management, Multi-Time Schedules, Weekdays & Timezones', async (t) => {
  let elderToken = '';
  let caretakerToken = '';
  let familyToken = '';
  let circleId = '';
  let medDailyId = '';
  let medWeekdayId = '';

  await t.test('Setup: Create care circle with Elder, Caretaker, and Family member', async () => {
    // 1. Elder
    const elderRes = await request(app).post('/api/auth/demo-login').send({ persona: 'elder' });
    elderToken = elderRes.body.token;

    const circleRes = await request(app)
      .post('/api/circles/create')
      .set('Authorization', `Bearer ${elderToken}`)
      .send({
        name: 'Sharma Medication Circle',
        elderName: 'Ramesh Sharma',
        passcode: 'medPass123',
        timezone: 'Asia/Kolkata'
      });
    assert.equal(circleRes.status, 201);
    circleId = circleRes.body.circle.id;

    // 2. Caretaker
    const caretakerRes = await request(app).post('/api/auth/demo-login').send({ persona: 'caretaker' });
    caretakerToken = caretakerRes.body.token;
    await request(app)
      .post('/api/circles/join')
      .set('Authorization', `Bearer ${caretakerToken}`)
      .send({ circleId, passcode: 'medPass123', role: 'caretaker' });

    // 3. Family
    const familyRes = await request(app).post('/api/auth/demo-login').send({ persona: 'family' });
    familyToken = familyRes.body.token;
    await request(app)
      .post('/api/circles/join')
      .set('Authorization', `Bearer ${familyToken}`)
      .send({ circleId, passcode: 'medPass123', role: 'family' });
  });

  // 1. Validation Tests
  await t.test('Validation: Rejects missing name, strength, or invalid dates', async () => {
    // Missing name
    const noNameRes = await request(app)
      .post('/api/medications')
      .set('Authorization', `Bearer ${elderToken}`)
      .send({ circleId, strength: '500mg', times: ['08:00'] });
    assert.equal(noNameRes.status, 400);

    // Missing strength
    const noStrengthRes = await request(app)
      .post('/api/medications')
      .set('Authorization', `Bearer ${elderToken}`)
      .send({ circleId, name: 'Paracetamol', times: ['08:00'] });
    assert.equal(noStrengthRes.status, 400);

    // End date earlier than start date
    const badDatesRes = await request(app)
      .post('/api/medications')
      .set('Authorization', `Bearer ${elderToken}`)
      .send({
        circleId,
        name: 'Antibiotic Course',
        strength: '250mg',
        startDate: '2026-12-10',
        endDate: '2026-12-05',
        times: ['08:00']
      });
    assert.equal(badDatesRes.status, 400);
    assert.match(badDatesRes.body.error, /End date cannot be earlier than start date/);

    // Invalid time format
    const badTimeRes = await request(app)
      .post('/api/medications')
      .set('Authorization', `Bearer ${elderToken}`)
      .send({
        circleId,
        name: 'Vitamin D',
        strength: '60k IU',
        times: ['25:99']
      });
    assert.equal(badTimeRes.status, 400);
    assert.match(badTimeRes.body.error, /Invalid time format/);
  });

  // 2. Permission Tests
  await t.test('Permissions: Elder and Caretaker can add/edit; Family blocked by default', async () => {
    // Family attempts to add medication -> 403
    const famAddRes = await request(app)
      .post('/api/medications')
      .set('Authorization', `Bearer ${familyToken}`)
      .send({
        circleId,
        name: 'Unauthorized Aspirin',
        strength: '75mg',
        times: ['08:00']
      });
    assert.equal(famAddRes.status, 403);

    // Caretaker adds daily medication with 3 times per day -> 201
    const caretakerAddRes = await request(app)
      .post('/api/medications')
      .set('Authorization', `Bearer ${caretakerToken}`)
      .send({
        circleId,
        name: 'Metformin Hydrochloride',
        strength: '500mg',
        form: 'Tablet',
        instructions: 'Take with or immediately after meals with plenty of water',
        startDate: '2026-11-01',
        frequencyType: 'daily',
        times: ['08:00', '13:00', '20:00'],
        sourceLabel: 'From the packaging'
      });
    assert.equal(caretakerAddRes.status, 201);
    assert.equal(caretakerAddRes.body.medication.instructionsType, 'user-entered');
    medDailyId = caretakerAddRes.body.medication.id;

    // Elder adds weekday medication (Mon, Wed, Fri only) with 2 times per day -> 201
    const elderAddRes = await request(app)
      .post('/api/medications')
      .set('Authorization', `Bearer ${elderToken}`)
      .send({
        circleId,
        name: 'Methotrexate',
        strength: '10mg',
        form: 'Tablet',
        instructions: 'Take on Monday, Wednesday, and Friday mornings only',
        startDate: '2026-11-01',
        frequencyType: 'weekdays',
        daysOfWeek: ['Mon', 'Wed', 'Fri'], // Days 1, 3, 5
        times: ['09:00', '21:00'],
        sourceLabel: 'From the packaging'
      });
    assert.equal(elderAddRes.status, 201);
    assert.deepEqual(elderAddRes.body.medication.daysOfWeek, [1, 3, 5]);
    medWeekdayId = elderAddRes.body.medication.id;
  });

  // 3. Schedule-to-Dose Generation (Multiple times & Weekdays)
  await t.test('Schedule-to-Dose Generation: Generates doses for today and 7-day range', async () => {
    const rangeRes = await request(app)
      .get(`/api/doses/range?circleId=${circleId}&days=7`)
      .set('Authorization', `Bearer ${elderToken}`);

    assert.equal(rangeRes.status, 200);
    assert.equal(rangeRes.body.success, true);
    assert.equal(rangeRes.body.dates.length, 8); // today + 7 days = 8 days

    const doses = rangeRes.body.doses;
    assert.ok(doses.length > 0);

    // Group doses by date
    const dosesByDate = {};
    doses.forEach(d => {
      dosesByDate[d.scheduledDate] = dosesByDate[d.scheduledDate] || [];
      dosesByDate[d.scheduledDate].push(d);
    });

    // Check each evaluated date
    rangeRes.body.dates.forEach(dateStr => {
      const dateDoses = dosesByDate[dateStr] || [];

      // Metformin (Daily, 3 times): MUST appear exactly 3 times on EVERY date
      const dailyMeds = dateDoses.filter(d => d.medicationId === medDailyId);
      assert.equal(dailyMeds.length, 3, `Expected 3 Metformin doses on ${dateStr}, got ${dailyMeds.length}`);
      const times = dailyMeds.map(d => d.scheduledTime).sort();
      assert.deepEqual(times, ['08:00', '13:00', '20:00']);

      // Methotrexate (Mon, Wed, Fri only, 2 times): MUST appear only on Mon, Wed, Fri
      const [year, month, day] = dateStr.split('-').map(Number);
      const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
      const isMWF = [1, 3, 5].includes(dayOfWeek);

      const weekdayMeds = dateDoses.filter(d => d.medicationId === medWeekdayId);
      if (isMWF) {
        assert.equal(weekdayMeds.length, 2, `Expected 2 Methotrexate doses on MWF (${dateStr}), got ${weekdayMeds.length}`);
        assert.deepEqual(weekdayMeds.map(d => d.scheduledTime).sort(), ['09:00', '21:00']);
      } else {
        assert.equal(weekdayMeds.length, 0, `Expected 0 Methotrexate doses on non-MWF (${dateStr}), got ${weekdayMeds.length}`);
      }
    });
  });

  // 4. Timezone Handling Tests
  await t.test('Timezone Handling: Correctly computes local dates and weekdays in circle timezone', () => {
    // 2026-11-15T01:00:00.000Z in UTC
    const utcDate = new Date('2026-11-15T01:00:00.000Z');

    // In Asia/Kolkata (+05:30), 01:00 UTC is 06:30 on 2026-11-15
    const kolkataDate = getLocalDateInTimezone(utcDate, 'Asia/Kolkata');
    assert.equal(kolkataDate, '2026-11-15');

    // In America/New_York (-05:00), 01:00 UTC is 20:00 on the PREVIOUS day 2026-11-14
    const nyDate = getLocalDateInTimezone(utcDate, 'America/New_York');
    assert.equal(nyDate, '2026-11-14');

    // Day of week in Kolkata is Sunday (0)
    const kolkataDay = getLocalDayOfWeekInTimezone(utcDate, 'Asia/Kolkata');
    assert.equal(kolkataDay, 0); // Sunday

    // Day of week in New York is Saturday (6)
    const nyDay = getLocalDayOfWeekInTimezone(utcDate, 'America/New_York');
    assert.equal(nyDay, 6); // Saturday
  });

  // 5. Medication Edit & Delete Operations
  await t.test('Edit & Delete: Caretaker can edit dosage and delete medication', async () => {
    // Edit Metformin strength and instructions
    const editRes = await request(app)
      .put(`/api/medications/${medDailyId}`)
      .set('Authorization', `Bearer ${caretakerToken}`)
      .send({
        circleId,
        strength: '1000mg',
        instructions: 'Updated: Take with dinner'
      });

    assert.equal(editRes.status, 200);
    assert.equal(editRes.body.medication.strength, '1000mg');
    assert.equal(editRes.body.medication.instructions, 'Updated: Take with dinner');

    // Delete Methotrexate
    const delRes = await request(app)
      .delete(`/api/medications/${medWeekdayId}?circleId=${circleId}`)
      .set('Authorization', `Bearer ${elderToken}`);

    assert.equal(delRes.status, 200);
    assert.equal(delRes.body.success, true);
  });
});
