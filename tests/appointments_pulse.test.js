import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../server/app.js';

test('Appointments and Daily Care Pulse Summary Suite', async (t) => {
  let elderToken = '';
  let caretakerToken = '';
  let familyToken = '';
  let circleId = '';
  let apptId1 = '';
  let apptId2 = '';
  let apptId3 = '';

  await t.test('Setup: Authenticate elder, caretaker, and family; create circle', async () => {
    const elderLogin = await request(app).post('/api/auth/demo-login').send({ persona: 'elder' });
    elderToken = elderLogin.body.token;

    const caretakerLogin = await request(app)
      .post('/api/auth/demo-login')
      .send({ persona: 'caretaker' });
    caretakerToken = caretakerLogin.body.token;

    const familyLogin = await request(app).post('/api/auth/demo-login').send({ persona: 'family' });
    familyToken = familyLogin.body.token;

    // Elder creates circle
    const createRes = await request(app)
      .post('/api/circles/create')
      .set('Authorization', `Bearer ${elderToken}`)
      .send({
        name: 'Pulse & Appt Test Circle',
        elderName: 'Shri Ram Sharma',
        passcode: 'secretPass123'
      });

    assert.equal(createRes.status, 201);
    circleId = createRes.body.circle.id;

    // Caretaker joins circle
    const joinCaretaker = await request(app)
      .post('/api/circles/join')
      .set('Authorization', `Bearer ${caretakerToken}`)
      .send({
        circleId,
        passcode: 'secretPass123',
        role: 'caretaker'
      });
    assert.equal(joinCaretaker.status, 200);

    // Family joins circle
    const joinFamily = await request(app)
      .post('/api/circles/join')
      .set('Authorization', `Bearer ${familyToken}`)
      .send({
        circleId,
        passcode: 'secretPass123',
        role: 'family'
      });
    assert.equal(joinFamily.status, 200);
  });

  await t.test('1. Appointment Validation: Reject incomplete or invalid payloads', async () => {
    // Missing doctorName
    const resNoDoctor = await request(app)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${elderToken}`)
      .send({
        circleId,
        datetime: new Date(Date.now() + 86400000).toISOString(),
        place: 'Apollo Clinic',
        purpose: 'Routine Checkup'
      });
    assert.equal(resNoDoctor.status, 400);
    assert.match(resNoDoctor.body.error, /Doctor name is required/i);

    // Missing datetime
    const resNoDate = await request(app)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${elderToken}`)
      .send({
        circleId,
        doctorName: 'Dr. Mehta',
        place: 'Apollo Clinic',
        purpose: 'Routine Checkup'
      });
    assert.equal(resNoDate.status, 400);
    assert.match(resNoDate.body.error, /date and time are required/i);

    // Invalid datetime format
    const resBadDate = await request(app)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${elderToken}`)
      .send({
        circleId,
        doctorName: 'Dr. Mehta',
        datetime: 'not-a-real-date',
        place: 'Apollo Clinic',
        purpose: 'Routine Checkup'
      });
    assert.equal(resBadDate.status, 400);
    assert.match(resBadDate.body.error, /Invalid appointment date and time/i);

    // Missing place / clinic
    const resNoPlace = await request(app)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${elderToken}`)
      .send({
        circleId,
        doctorName: 'Dr. Mehta',
        datetime: new Date(Date.now() + 86400000).toISOString(),
        purpose: 'Routine Checkup'
      });
    assert.equal(resNoPlace.status, 400);
    assert.match(resNoPlace.body.error, /Clinic, hospital, or place is required/i);
  });

  await t.test('2. Appointment Scheduling & Chronological Ordering', async () => {
    // We add 3 appointments out of chronological order:
    // Appt A: 3 days in future
    const dateA = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString();
    // Appt B: 1 day in future
    const dateB = new Date(Date.now() + 1 * 24 * 3600 * 1000).toISOString();
    // Appt C: 5 days in future
    const dateC = new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString();

    const resA = await request(app)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${elderToken}`)
      .send({
        circleId,
        doctorName: 'Dr. Avasthi',
        purpose: 'Orthopedic Consultation',
        datetime: dateA,
        place: 'Joint & Spine Care Center',
        notes: 'Bring previous knee X-ray'
      });
    assert.equal(resA.status, 201);
    apptId1 = resA.body.appointment.id;

    const resB = await request(app)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${elderToken}`)
      .send({
        circleId,
        doctorName: 'Dr. Bhatt',
        purpose: 'Ophthalmology Eye Exam',
        datetime: dateB,
        place: 'City Eye Hospital',
        notes: 'Dilation required, bring sunglasses'
      });
    assert.equal(resB.status, 201);
    apptId2 = resB.body.appointment.id;

    const resC = await request(app)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${elderToken}`)
      .send({
        circleId,
        doctorName: 'Dr. Chawla',
        purpose: 'Cardiology Review',
        datetime: dateC,
        place: 'Heart Care Institute',
        notes: 'Fasting lipid profile required'
      });
    assert.equal(resC.status, 201);
    apptId3 = resC.body.appointment.id;

    // Retrieve appointments list: must be sorted ascending by date (B, then A, then C)
    const listRes = await request(app)
      .get(`/api/appointments?circleId=${circleId}`)
      .set('Authorization', `Bearer ${elderToken}`);

    assert.equal(listRes.status, 200);
    assert.ok(listRes.body.appointments.length >= 3);

    const appts = listRes.body.appointments;
    const idxB = appts.findIndex((a) => a.id === apptId2);
    const idxA = appts.findIndex((a) => a.id === apptId1);
    const idxC = appts.findIndex((a) => a.id === apptId3);

    assert.ok(idxB < idxA, 'Dr. Bhatt (1 day) should appear before Dr. Avasthi (3 days)');
    assert.ok(idxA < idxC, 'Dr. Avasthi (3 days) should appear before Dr. Chawla (5 days)');
  });

  await t.test('3. Edit and Cancel Appointments', async () => {
    // Edit Appt 1
    const editRes = await request(app)
      .put(`/api/appointments/${apptId1}`)
      .set('Authorization', `Bearer ${elderToken}`)
      .send({
        circleId,
        doctorName: 'Dr. Avasthi (Senior Orthopedic)',
        place: 'Fortis Joint Center',
        notes: 'Updated: knee brace prescribed'
      });

    assert.equal(editRes.status, 200);
    assert.equal(editRes.body.appointment.doctorName, 'Dr. Avasthi (Senior Orthopedic)');
    assert.equal(editRes.body.appointment.place, 'Fortis Joint Center');

    // Cancel Appt 3
    const cancelRes = await request(app)
      .post(`/api/appointments/${apptId3}/cancel`)
      .set('Authorization', `Bearer ${elderToken}`)
      .send({
        circleId,
        cancelReason: 'Doctor rescheduled conference'
      });

    assert.equal(cancelRes.status, 200);
    assert.equal(cancelRes.body.appointment.status, 'Cancelled');
    assert.equal(cancelRes.body.appointment.cancelReason, 'Doctor rescheduled conference');
  });

  await t.test('4. Permission Checks: Elder, Caretaker, and Family roles', async () => {
    // Caretaker allowed by default
    const caretakerApptRes = await request(app)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${caretakerToken}`)
      .send({
        circleId,
        doctorName: 'Dr. Caretaker Specialist',
        purpose: 'General Checkup',
        datetime: new Date(Date.now() + 4 * 86400000).toISOString(),
        place: 'Care Clinic'
      });
    assert.equal(caretakerApptRes.status, 201);

    // Family member BLOCKED by default (403 Forbidden)
    const familyApptRes = await request(app)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${familyToken}`)
      .send({
        circleId,
        doctorName: 'Dr. Family Added',
        purpose: 'Dental Consultation',
        datetime: new Date(Date.now() + 6 * 86400000).toISOString(),
        place: 'Smile Dental'
      });
    assert.equal(familyApptRes.status, 403);
    assert.match(familyApptRes.body.error, /permission/i);

    // Elder updates circle permissions to grant family appointment management
    const permRes = await request(app)
      .put('/api/circles/permissions')
      .set('Authorization', `Bearer ${elderToken}`)
      .send({
        circleId,
        permissions: {
          familyCanManageAppointments: true
        }
      });
    assert.equal(permRes.status, 200);

    // Now Family is ALLOWED
    const familyAllowedRes = await request(app)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${familyToken}`)
      .send({
        circleId,
        doctorName: 'Dr. Family Permitted',
        purpose: 'Dental Consultation',
        datetime: new Date(Date.now() + 6 * 86400000).toISOString(),
        place: 'Smile Dental'
      });
    assert.equal(familyAllowedRes.status, 201);
  });

  await t.test('5. Daily Care Pulse Summary Calculation', async () => {
    // Add active medication schedules to test dose generation & pulse calculation
    const medRes = await request(app)
      .post('/api/medications')
      .set('Authorization', `Bearer ${elderToken}`)
      .send({
        circleId,
        name: 'Metformin Hydrochloride',
        strength: '500mg',
        form: 'Tablet',
        times: ['08:00', '14:00', '20:00'],
        instructions: 'Take with food and water',
        sourceLabel: 'From the packaging'
      });
    assert.equal(medRes.status, 201);

    // Request the Daily Care Pulse
    const pulseRes = await request(app)
      .get(`/api/doses/pulse?circleId=${circleId}`)
      .set('Authorization', `Bearer ${elderToken}`);

    assert.equal(pulseRes.status, 200);
    assert.equal(pulseRes.body.success, true);

    const pulse = pulseRes.body.pulse;
    assert.equal(pulse.circleId, circleId);
    assert.equal(pulse.elderName, 'Shri Ram Sharma');
    assert.ok(pulse.totalDosesToday >= 3);
    assert.equal(pulse.pendingCount, pulse.totalDosesToday);
    assert.equal(pulse.takenCount, 0);

    // Verify human-readable completion indicator
    assert.ok(typeof pulse.completionText === 'string');
    assert.match(pulse.completionText, /0 of \d+ doses taken/i);

    // Verify next upcoming dose object & text label
    assert.ok(pulse.nextUpcomingDose);
    assert.ok(pulse.nextUpcomingDose.textLabel);
    assert.match(pulse.nextUpcomingDose.textLabel, /Metformin/i);

    // Verify upcoming appointments are included and sorted
    assert.ok(Array.isArray(pulse.upcomingAppointments));
    assert.ok(pulse.upcomingAppointments.length > 0);

    // Verify status text badge (never color alone)
    assert.ok(pulse.statusTextBadge);
    assert.match(pulse.statusTextBadge, /\[.+\]/);

    // Now mark one dose as Taken and one as Missed to verify pulse status badge & alerts
    const dosesRes = await request(app)
      .get(`/api/doses?circleId=${circleId}`)
      .set('Authorization', `Bearer ${elderToken}`);

    const doseList = dosesRes.body.doses;
    assert.ok(doseList.length >= 2);

    // Mark dose 1 as Taken
    await request(app)
      .put(`/api/doses/${doseList[0].id}/status`)
      .set('Authorization', `Bearer ${elderToken}`)
      .send({ circleId, status: 'Taken' });

    // Mark dose 2 as Missed
    await request(app)
      .put(`/api/doses/${doseList[1].id}/status`)
      .set('Authorization', `Bearer ${elderToken}`)
      .send({ circleId, status: 'Missed', missedReason: 'Patient felt dizzy' });

    // Re-fetch pulse
    const updatedPulseRes = await request(app)
      .get(`/api/doses/pulse?circleId=${circleId}`)
      .set('Authorization', `Bearer ${elderToken}`);

    const updatedPulse = updatedPulseRes.body.pulse;
    assert.equal(updatedPulse.takenCount, 1);
    assert.equal(updatedPulse.missedCount, 1);
    assert.match(updatedPulse.completionText, /1 of \d+ doses taken/i);

    // Verify active alert for missed dose was generated
    assert.ok(Array.isArray(updatedPulse.activeAlerts));
    const missedAlert = updatedPulse.activeAlerts.find((a) => a.type === 'missed-dose');
    assert.ok(missedAlert, 'Active alert for missed dose must be present');
    assert.equal(missedAlert.badgeText, '[ACTION REQUIRED: MISSED DOSE]');
    assert.match(missedAlert.message, /Missed: Metformin/i);

    // Verify status text badge indicates attention required
    assert.equal(updatedPulse.statusTextBadge, '[ATTENTION REQUIRED: MISSED DOSE]');
  });
});
