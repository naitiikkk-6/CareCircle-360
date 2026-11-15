import express from 'express';
import { getDb } from '../db.js';
import { verifyAuthToken } from '../middleware/auth.js';
import {
  requireCircleAccess,
  requireAppointmentManagePermission,
  requireViewAppointmentsPermission
} from '../middleware/permissions.js';
import { logCircleActivity } from '../services/activityService.js';

const router = express.Router();

/**
 * List appointments for a circle.
 * Returns upcoming appointments first, in ascending chronological order.
 */
router.get('/', verifyAuthToken, requireCircleAccess, requireViewAppointmentsPermission, async (req, res) => {
  try {
    const db = getDb();
    const snap = await db.collection('appointments')
      .where('circleId', '==', req.circle.id)
      .get();

    const appointments = [];
    snap.forEach(doc => appointments.push(doc.data()));

    // Chronological ordering: earliest datetime first
    appointments.sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime());

    // Separate upcoming from completed/cancelled if requested
    const upcoming = appointments.filter(a => a.status === 'Upcoming');
    const pastOrCancelled = appointments.filter(a => a.status !== 'Upcoming');

    return res.json({
      success: true,
      appointments,
      upcoming,
      pastOrCancelled
    });
  } catch (err) {
    console.error('List appointments error:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve appointments.' });
  }
});

/**
 * Add a doctor appointment.
 * Required: doctorName, datetime, place, purpose.
 * Permission: Elder or permitted Caretaker / Family.
 */
router.post('/', verifyAuthToken, requireCircleAccess, requireAppointmentManagePermission, async (req, res) => {
  try {
    const {
      doctorName,
      place,
      location,
      datetime,
      purpose,
      specialty,
      notes = ''
    } = req.body;

    // Validation
    if (!doctorName || typeof doctorName !== 'string' || doctorName.trim().length === 0) {
      return res.status(400).json({ success: false, error: 'Doctor name is required.' });
    }

    if (!datetime) {
      return res.status(400).json({ success: false, error: 'Appointment date and time are required.' });
    }

    const dateObj = new Date(datetime);
    if (isNaN(dateObj.getTime())) {
      return res.status(400).json({ success: false, error: 'Invalid appointment date and time format.' });
    }

    const effectivePlace = (place || location || '').trim();
    if (!effectivePlace) {
      return res.status(400).json({ success: false, error: 'Clinic, hospital, or place is required.' });
    }

    const effectivePurpose = (purpose || specialty || 'General Consultation').trim();

    const apptId = 'appt_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);
    const db = getDb();

    const newAppt = {
      id: apptId,
      circleId: req.circle.id,
      doctorName: doctorName.trim(),
      place: effectivePlace,
      location: effectivePlace, // backward-compatible alias
      datetime: new Date(datetime).toISOString(),
      purpose: effectivePurpose,
      specialty: effectivePurpose, // backward-compatible alias
      notes: typeof notes === 'string' ? notes.trim() : '',
      status: 'Upcoming',
      reminderSent: false,
      createdBy: {
        uid: req.user.uid,
        name: req.user.name,
        role: req.userRole
      },
      createdAt: new Date().toISOString()
    };

    await db.collection('appointments').doc(apptId).set(newAppt);

    await logCircleActivity({
      circleId: req.circle.id,
      action: 'APPOINTMENT_SCHEDULED',
      details: `${req.user.name} scheduled appointment with ${newAppt.doctorName} for ${newAppt.datetime}`,
      actor: req.user
    });

    return res.status(201).json({
      success: true,
      message: 'Doctor appointment scheduled successfully.',
      appointment: newAppt
    });
  } catch (err) {
    console.error('Add appointment error:', err);
    return res.status(500).json({ success: false, error: 'Failed to add appointment.' });
  }
});

/**
 * Edit an existing appointment.
 */
router.put('/:id', verifyAuthToken, requireCircleAccess, requireAppointmentManagePermission, async (req, res) => {
  try {
    const { id } = req.params;
    const db = getDb();
    const apptDoc = await db.collection('appointments').doc(id).get();

    if (!apptDoc.exists || apptDoc.data().circleId !== req.circle.id) {
      return res.status(404).json({ success: false, error: 'Appointment not found in this circle.' });
    }

    const { doctorName, place, location, datetime, purpose, specialty, notes, status } = req.body;
    const updates = {};

    if (doctorName !== undefined) {
      if (!doctorName || typeof doctorName !== 'string' || doctorName.trim().length === 0) {
        return res.status(400).json({ success: false, error: 'Doctor name cannot be empty.' });
      }
      updates.doctorName = doctorName.trim();
    }

    if (datetime !== undefined) {
      const d = new Date(datetime);
      if (isNaN(d.getTime())) {
        return res.status(400).json({ success: false, error: 'Invalid date/time format.' });
      }
      updates.datetime = d.toISOString();
    }

    if (place !== undefined || location !== undefined) {
      const p = (place || location || '').trim();
      if (!p) return res.status(400).json({ success: false, error: 'Place cannot be empty.' });
      updates.place = p;
      updates.location = p;
    }

    if (purpose !== undefined || specialty !== undefined) {
      const purp = (purpose || specialty || '').trim();
      if (!purp) return res.status(400).json({ success: false, error: 'Purpose cannot be empty.' });
      updates.purpose = purp;
      updates.specialty = purp;
    }

    if (notes !== undefined) updates.notes = typeof notes === 'string' ? notes.trim() : '';

    if (status !== undefined) {
      if (!['Upcoming', 'Completed', 'Cancelled'].includes(status)) {
        return res.status(400).json({ success: false, error: 'Status must be "Upcoming", "Completed", or "Cancelled".' });
      }
      updates.status = status;
    }

    updates.updatedAt = new Date().toISOString();
    updates.updatedBy = {
      uid: req.user.uid,
      name: req.user.name,
      role: req.userRole
    };

    await db.collection('appointments').doc(id).update(updates);
    const updated = { ...apptDoc.data(), ...updates };

    await logCircleActivity({
      circleId: req.circle.id,
      action: 'APPOINTMENT_UPDATED',
      details: `${req.user.name} updated appointment with ${updated.doctorName}`,
      actor: req.user
    });

    return res.json({
      success: true,
      message: 'Appointment updated successfully.',
      appointment: updated
    });
  } catch (err) {
    console.error('Update appointment error:', err);
    return res.status(500).json({ success: false, error: 'Failed to update appointment.' });
  }
});

/**
 * Cancel an appointment.
 */
router.post('/:id/cancel', verifyAuthToken, requireCircleAccess, requireAppointmentManagePermission, async (req, res) => {
  try {
    const { id } = req.params;
    const db = getDb();
    const apptDoc = await db.collection('appointments').doc(id).get();

    if (!apptDoc.exists || apptDoc.data().circleId !== req.circle.id) {
      return res.status(404).json({ success: false, error: 'Appointment not found in this circle.' });
    }

    const { cancelReason = '' } = req.body;
    const updates = {
      status: 'Cancelled',
      cancelReason: typeof cancelReason === 'string' ? cancelReason.trim() : 'Cancelled by user',
      cancelledAt: new Date().toISOString(),
      cancelledBy: {
        uid: req.user.uid,
        name: req.user.name,
        role: req.userRole
      }
    };

    await db.collection('appointments').doc(id).update(updates);
    const updated = { ...apptDoc.data(), ...updates };

    await logCircleActivity({
      circleId: req.circle.id,
      action: 'APPOINTMENT_CANCELLED',
      details: `${req.user.name} cancelled appointment with ${updated.doctorName}`,
      actor: req.user
    });

    return res.json({
      success: true,
      message: 'Appointment cancelled.',
      appointment: updated
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to cancel appointment.' });
  }
});

/**
 * Delete an appointment completely.
 */
router.delete('/:id', verifyAuthToken, requireCircleAccess, requireAppointmentManagePermission, async (req, res) => {
  try {
    const { id } = req.params;
    const db = getDb();
    const apptDoc = await db.collection('appointments').doc(id).get();

    if (!apptDoc.exists || apptDoc.data().circleId !== req.circle.id) {
      return res.status(404).json({ success: false, error: 'Appointment not found.' });
    }

    const docName = apptDoc.data().doctorName;
    await db.collection('appointments').doc(id).delete();

    await logCircleActivity({
      circleId: req.circle.id,
      action: 'APPOINTMENT_DELETED',
      details: `${req.user.name} deleted appointment with ${docName}`,
      actor: req.user
    });

    return res.json({ success: true, message: 'Appointment deleted successfully.' });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to delete appointment.' });
  }
});

export default router;
