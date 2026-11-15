import express from 'express';
import { getDb } from '../db.js';
import { verifyAuthToken } from '../middleware/auth.js';
import {
  requireCircleAccess,
  requireMedicationManagePermission,
  requireViewMedicinesPermission
} from '../middleware/permissions.js';
import { logCircleActivity } from '../services/activityService.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = express.Router();

/**
 * List all medications in a circle.
 */
router.get(
  '/',
  verifyAuthToken,
  requireCircleAccess,
  requireViewMedicinesPermission,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const snap = await db.collection('medications').where('circleId', '==', req.circle.id).get();

    const medications = [];
    snap.forEach((doc) => medications.push(doc.data()));

    return res.json({ success: true, medications });
  })
);

/**
 * Get a single medication by ID.
 */
router.get(
  '/:medId',
  verifyAuthToken,
  requireCircleAccess,
  requireViewMedicinesPermission,
  asyncHandler(async (req, res) => {
    const { medId } = req.params;
    const db = getDb();
    const doc = await db.collection('medications').doc(medId).get();

    if (!doc.exists || doc.data().circleId !== req.circle.id) {
      return res
        .status(404)
        .json({ success: false, error: 'Medication not found in this circle.' });
    }

    return res.json({ success: true, medication: doc.data() });
  })
);

/**
 * Add a new medication to the circle.
 * Validates inputs: name, strength, form, user-typed instructions, startDate, endDate, frequency, times.
 * Permissions: Elder or permitted Caretaker / Family.
 */
router.post(
  '/',
  verifyAuthToken,
  requireCircleAccess,
  requireMedicationManagePermission,
  async (req, res) => {
    try {
      const {
        name,
        strength: rawStrength,
        dosage,
        form = 'Tablet',
        instructions = '',
        packagingInstructions,
        startDate,
        endDate = null,
        frequencyType = 'daily',
        daysOfWeek = [],
        times: rawTimes,
        schedules,
        sourceLabel = 'Not verified - ask your pharmacist or doctor',
        notes = ''
      } = req.body;

      const strength = rawStrength || dosage;
      const effectiveInstructions = instructions || packagingInstructions || '';
      const times = rawTimes || schedules;

      // 1. Validation: Name & Strength
      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ success: false, error: 'Medication name is required.' });
      }
      if (!strength || typeof strength !== 'string' || strength.trim().length === 0) {
        return res
          .status(400)
          .json({ success: false, error: 'Strength / dosage is required (e.g. 500mg, 10ml).' });
      }

      // 2. Validation: Dates
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      const effectiveStartDate = startDate || new Date().toISOString().split('T')[0];
      if (!dateRegex.test(effectiveStartDate)) {
        return res
          .status(400)
          .json({ success: false, error: 'Start date must be in YYYY-MM-DD format.' });
      }
      if (endDate && !dateRegex.test(endDate)) {
        return res
          .status(400)
          .json({ success: false, error: 'End date must be in YYYY-MM-DD format.' });
      }
      if (endDate && endDate < effectiveStartDate) {
        return res
          .status(400)
          .json({ success: false, error: 'End date cannot be earlier than start date.' });
      }

      // 3. Validation: Frequency & Times
      if (!['daily', 'weekdays'].includes(frequencyType)) {
        return res
          .status(400)
          .json({ success: false, error: 'Frequency must be "daily" or "weekdays".' });
      }

      if (frequencyType === 'weekdays' && (!Array.isArray(daysOfWeek) || daysOfWeek.length === 0)) {
        return res.status(400).json({
          success: false,
          error: 'Please specify at least one day of the week for weekday schedules.'
        });
      }

      // Normalizing times
      let timeList = [];
      if (Array.isArray(times)) {
        timeList = times
          .map((t) => (typeof t === 'string' ? t.trim() : t.time?.trim()))
          .filter(Boolean);
      } else if (typeof times === 'string') {
        timeList = [times.trim()];
      }

      if (timeList.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'At least one scheduled intake time is required (e.g. 08:00).'
        });
      }

      const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
      for (const t of timeList) {
        if (!timeRegex.test(t)) {
          return res.status(400).json({
            success: false,
            error: `Invalid time format "${t}". Expected HH:MM in 24-hour format (e.g. 08:00).`
          });
        }
      }

      // Deduplicate and sort times
      timeList = Array.from(new Set(timeList)).sort();

      // 4. Source label enforcement
      const validSourceLabels = [
        'From the packaging',
        'Not verified - ask your pharmacist or doctor'
      ];
      const finalSourceLabel = validSourceLabels.includes(sourceLabel)
        ? sourceLabel
        : 'Not verified - ask your pharmacist or doctor';

      const db = getDb();
      const medId =
        'med_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);

      const newMed = {
        id: medId,
        circleId: req.circle.id,
        name: name.trim(),
        strength: strength.trim(),
        dosage: strength.trim(), // backward-compatible alias
        form: typeof form === 'string' ? form.trim() : 'Tablet',
        instructions: typeof effectiveInstructions === 'string' ? effectiveInstructions.trim() : '',
        packagingInstructions:
          typeof effectiveInstructions === 'string' ? effectiveInstructions.trim() : '', // backward-compatible alias
        instructionsType: 'user-entered', // Clearly designates instructions as typed by user
        startDate: effectiveStartDate,
        endDate: endDate || null,
        frequencyType,
        daysOfWeek:
          frequencyType === 'weekdays' ? normalizeDaysOfWeek(daysOfWeek) : [0, 1, 2, 3, 4, 5, 6],
        times: timeList,
        schedules: timeList.map((t) => ({ time: t })), // backward-compatible alias
        sourceLabel: finalSourceLabel,
        notes: typeof notes === 'string' ? notes.trim() : '',
        active: true,
        addedBy: {
          uid: req.user.uid,
          name: req.user.name,
          role: req.userRole
        },
        createdAt: new Date().toISOString()
      };

      await db.collection('medications').doc(medId).set(newMed);

      await logCircleActivity({
        circleId: req.circle.id,
        action: 'MEDICATION_ADDED',
        details: `Added ${newMed.name} (${newMed.strength}) - Form: ${newMed.form}`,
        actor: req.user
      });

      return res.status(201).json({
        success: true,
        message: 'Medication added successfully.',
        medication: newMed
      });
    } catch (err) {
      console.error('Add med error:', err);
      return res.status(500).json({ success: false, error: 'Failed to add medication.' });
    }
  }
);

/**
 * Edit an existing medication.
 */
router.put(
  '/:medId',
  verifyAuthToken,
  requireCircleAccess,
  requireMedicationManagePermission,
  async (req, res) => {
    try {
      const { medId } = req.params;
      const db = getDb();
      const medDoc = await db.collection('medications').doc(medId).get();

      if (!medDoc.exists || medDoc.data().circleId !== req.circle.id) {
        return res
          .status(404)
          .json({ success: false, error: 'Medication not found in this Care Circle.' });
      }

      const currentMed = medDoc.data();
      const {
        name,
        strength,
        form,
        instructions,
        startDate,
        endDate,
        frequencyType,
        daysOfWeek,
        times,
        sourceLabel,
        notes,
        active
      } = req.body;

      const updates = {};
      if (name !== undefined) {
        if (!name || typeof name !== 'string' || name.trim().length === 0) {
          return res
            .status(400)
            .json({ success: false, error: 'Medication name cannot be empty.' });
        }
        updates.name = name.trim();
      }

      if (strength !== undefined) {
        if (!strength || typeof strength !== 'string' || strength.trim().length === 0) {
          return res.status(400).json({ success: false, error: 'Strength cannot be empty.' });
        }
        updates.strength = strength.trim();
        updates.dosage = strength.trim();
      }

      if (form !== undefined) updates.form = form.trim();
      if (instructions !== undefined) {
        updates.instructions = instructions.trim();
        updates.packagingInstructions = instructions.trim();
        updates.instructionsType = 'user-entered';
      }

      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      const effectiveStart = startDate !== undefined ? startDate : currentMed.startDate;
      const effectiveEnd = endDate !== undefined ? endDate : currentMed.endDate;

      if (startDate !== undefined) {
        if (!dateRegex.test(startDate)) {
          return res
            .status(400)
            .json({ success: false, error: 'Start date must be in YYYY-MM-DD format.' });
        }
        updates.startDate = startDate;
      }

      if (endDate !== undefined) {
        if (endDate && !dateRegex.test(endDate)) {
          return res
            .status(400)
            .json({ success: false, error: 'End date must be in YYYY-MM-DD format.' });
        }
        updates.endDate = endDate || null;
      }

      if (effectiveEnd && effectiveEnd < effectiveStart) {
        return res
          .status(400)
          .json({ success: false, error: 'End date cannot be earlier than start date.' });
      }

      if (frequencyType !== undefined) {
        if (!['daily', 'weekdays'].includes(frequencyType)) {
          return res
            .status(400)
            .json({ success: false, error: 'Frequency must be "daily" or "weekdays".' });
        }
        updates.frequencyType = frequencyType;
        if (frequencyType === 'weekdays') {
          const days = daysOfWeek !== undefined ? daysOfWeek : currentMed.daysOfWeek;
          if (!Array.isArray(days) || days.length === 0) {
            return res
              .status(400)
              .json({ success: false, error: 'Please specify days of the week.' });
          }
          updates.daysOfWeek = normalizeDaysOfWeek(days);
        } else {
          updates.daysOfWeek = [0, 1, 2, 3, 4, 5, 6];
        }
      } else if (daysOfWeek !== undefined && currentMed.frequencyType === 'weekdays') {
        updates.daysOfWeek = normalizeDaysOfWeek(daysOfWeek);
      }

      if (times !== undefined) {
        let timeList = Array.isArray(times)
          ? times.map((t) => (typeof t === 'string' ? t.trim() : t.time?.trim())).filter(Boolean)
          : [times.trim()];

        if (timeList.length === 0) {
          return res
            .status(400)
            .json({ success: false, error: 'At least one scheduled intake time is required.' });
        }

        const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
        for (const t of timeList) {
          if (!timeRegex.test(t)) {
            return res.status(400).json({ success: false, error: `Invalid time format "${t}".` });
          }
        }

        timeList = Array.from(new Set(timeList)).sort();
        updates.times = timeList;
        updates.schedules = timeList.map((t) => ({ time: t }));
      }

      if (sourceLabel !== undefined) {
        updates.sourceLabel =
          sourceLabel === 'From the packaging'
            ? 'From the packaging'
            : 'Not verified - ask your pharmacist or doctor';
      }

      if (notes !== undefined) updates.notes = notes.trim();
      if (active !== undefined) updates.active = Boolean(active);

      updates.lastUpdatedBy = {
        uid: req.user.uid,
        name: req.user.name,
        role: req.userRole
      };
      updates.updatedAt = new Date().toISOString();

      await db.collection('medications').doc(medId).update(updates);
      const updated = { ...currentMed, ...updates };

      await logCircleActivity({
        circleId: req.circle.id,
        action: 'MEDICATION_UPDATED',
        details: `Updated ${updated.name} (${updated.strength})`,
        actor: req.user
      });

      return res.json({
        success: true,
        message: 'Medication updated successfully.',
        medication: updated
      });
    } catch (err) {
      console.error('Update med error:', err);
      return res.status(500).json({ success: false, error: 'Failed to update medication.' });
    }
  }
);

/**
 * Delete a medication.
 */
router.delete(
  '/:medId',
  verifyAuthToken,
  requireCircleAccess,
  requireMedicationManagePermission,
  async (req, res) => {
    try {
      const { medId } = req.params;
      const db = getDb();
      const medDoc = await db.collection('medications').doc(medId).get();

      if (!medDoc.exists || medDoc.data().circleId !== req.circle.id) {
        return res.status(404).json({ success: false, error: 'Medication not found.' });
      }

      const medName = medDoc.data().name;
      await db.collection('medications').doc(medId).delete();

      await logCircleActivity({
        circleId: req.circle.id,
        action: 'MEDICATION_DELETED',
        details: `Deleted medication ${medName}`,
        actor: req.user
      });

      return res.json({
        success: true,
        message: 'Medication removed from circle schedule.'
      });
    } catch (err) {
      console.error('Delete medication error:', err);
      return res.status(500).json({ success: false, error: 'Failed to delete medication.' });
    }
  }
);

function normalizeDaysOfWeek(days) {
  const dayMap = {
    sun: 0,
    sunday: 0,
    mon: 1,
    monday: 1,
    tue: 2,
    tuesday: 2,
    wed: 3,
    wednesday: 3,
    thu: 4,
    thursday: 4,
    fri: 5,
    friday: 5,
    sat: 6,
    saturday: 6
  };

  const normalized = new Set();
  days.forEach((d) => {
    if (typeof d === 'number' && d >= 0 && d <= 6) {
      normalized.add(d);
    } else if (typeof d === 'string') {
      const parsed = dayMap[d.toLowerCase().trim()];
      if (parsed !== undefined) normalized.add(parsed);
    }
  });

  return Array.from(normalized).sort((a, b) => a - b);
}

export default router;
