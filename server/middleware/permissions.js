import { getDb } from '../db.js';

/**
 * Middleware to verify circle membership, resolve user role, and enforce instant revocation.
 * Prevents cross-circle access and immediately blocks any member whose access has been revoked.
 */
export async function requireCircleAccess(req, res, next) {
  try {
    const circleId = req.params.circleId || req.body?.circleId || req.query?.circleId || req.headers['x-circle-id'] || req.headers['circle-id'];
    if (!circleId) {
      return res.status(400).json({
        success: false,
        error: 'Care circle identifier (circleId) is required.'
      });
    }

    const db = getDb();
    const circleDoc = await db.collection('careCircles').doc(circleId).get();

    if (!circleDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Care circle not found.'
      });
    }

    const circle = circleDoc.data();
    const uid = req.user.uid;

    // Check if user is elder (circle owner)
    if (circle.elderUid === uid) {
      req.circle = circle;
      req.userRole = 'elder';
      req.isElder = true;
      req.memberPermissions = {
        canViewMedicines: true,
        canViewDoses: true,
        canViewAppointments: true,
        canViewReadings: true,
        canEditMedicines: true,
        canEditDoses: true,
        canEditAppointments: true
      };
      req.membership = {
        role: 'elder',
        name: circle.elderName || req.user.name,
        email: circle.elderEmail || req.user.email,
        uid
      };
      return next();
    }

    // Check members list (Caretaker or Family)
    const member = (circle.members || []).find(m => m.uid === uid);
    if (!member) {
      return res.status(403).json({
        success: false,
        error: 'Access denied: You are not a registered member of this Care Circle.'
      });
    }

    // Strict instantaneous revocation check
    if (member.isRevoked) {
      return res.status(403).json({
        success: false,
        error: 'Access denied: Your access to this Care Circle has been revoked by the circle owner.'
      });
    }

    req.circle = circle;
    req.userRole = member.role; // 'caretaker' or 'family'
    req.isElder = false;
    req.membership = member;
    req.memberPermissions = member.permissions || {};

    next();
  } catch (err) {
    console.error('Error resolving circle access:', err);
    return res.status(500).json({
      success: false,
      error: 'Failed to verify care circle permissions.'
    });
  }
}

/**
 * Middleware ensuring only the Elder (circle owner) can perform the action.
 */
export function requireElderOnly(req, res, next) {
  if (req.userRole !== 'elder') {
    return res.status(403).json({
      success: false,
      error: 'Permission denied: This action requires Elder (circle owner) authority.'
    });
  }
  next();
}

/**
 * Middleware ensuring user is Elder or Caretaker (Family blocked).
 */
export function requireCaretakerOrElder(req, res, next) {
  if (req.userRole === 'elder' || req.userRole === 'caretaker') {
    return next();
  }
  return res.status(403).json({
    success: false,
    error: 'Permission denied: This action requires Caretaker or Elder authority.'
  });
}

/**
 * Permission to view medications catalog.
 * Evaluates member-level sharing settings.
 */
export function requireViewMedicinesPermission(req, res, next) {
  if (req.userRole === 'elder') return next();

  if (req.memberPermissions?.canViewMedicines === false) {
    return res.status(403).json({
      success: false,
      error: 'Permission denied: You do not have permission to view medications in this Care Circle.'
    });
  }

  next();
}

/**
 * Middleware ensuring user has permission to manage medications (add/edit/delete).
 * Evaluates member-level permissions first, then falls back to circle sharing defaults.
 */
export function requireMedicationManagePermission(req, res, next) {
  if (req.userRole === 'elder') return next();

  // Member-level override
  if (req.memberPermissions?.canEditMedicines !== undefined) {
    if (req.memberPermissions.canEditMedicines === true) return next();
    return res.status(403).json({
      success: false,
      error: 'Permission denied: You do not have permission to add or modify medications in this Care Circle.'
    });
  }

  // Circle-level fallback
  const permissions = req.circle.permissions || {};
  if (req.userRole === 'caretaker' && permissions.caretakerCanManageMeds !== false) {
    return next();
  }
  if (req.userRole === 'family' && permissions.familyCanManageMeds === true) {
    return next();
  }

  return res.status(403).json({
    success: false,
    error: 'Permission denied: You do not have permission to add or modify medications in this Care Circle.'
  });
}

/**
 * Permission to view doses & adherence pulse.
 */
export function requireViewDosesPermission(req, res, next) {
  if (req.userRole === 'elder') return next();

  if (req.memberPermissions?.canViewDoses === false) {
    return res.status(403).json({
      success: false,
      error: 'Permission denied: You do not have permission to view dose tracking records in this Care Circle.'
    });
  }

  next();
}

/**
 * Middleware ensuring user has permission to log dose statuses (Taken/Missed/Pending).
 * Evaluates member-level permissions first, then falls back to circle sharing defaults.
 */
export function requireDoseLogPermission(req, res, next) {
  if (req.userRole === 'elder') return next();

  // Member-level override
  if (req.memberPermissions?.canEditDoses !== undefined) {
    if (req.memberPermissions.canEditDoses === true) return next();
    return res.status(403).json({
      success: false,
      error: 'Permission denied: You do not have permission to log doses in this Care Circle.'
    });
  }

  // Circle-level fallback
  const permissions = req.circle.permissions || {};
  if (req.userRole === 'caretaker' && permissions.caretakerCanLogDoses !== false) {
    return next();
  }
  if (req.userRole === 'family' && permissions.familyCanLogDoses === true) {
    return next();
  }

  return res.status(403).json({
    success: false,
    error: 'Permission denied: You do not have permission to log doses in this Care Circle.'
  });
}

/**
 * Permission to view appointments.
 */
export function requireViewAppointmentsPermission(req, res, next) {
  if (req.userRole === 'elder') return next();

  if (req.memberPermissions?.canViewAppointments === false) {
    return res.status(403).json({
      success: false,
      error: 'Permission denied: You do not have permission to view doctor appointments.'
    });
  }

  next();
}

/**
 * Middleware ensuring user has permission to manage doctor appointments.
 * Evaluates member-level permissions first, then falls back to circle sharing defaults.
 */
export function requireAppointmentManagePermission(req, res, next) {
  if (req.userRole === 'elder') return next();

  // Member-level override
  if (req.memberPermissions?.canEditAppointments !== undefined) {
    if (req.memberPermissions.canEditAppointments === true) return next();
    return res.status(403).json({
      success: false,
      error: 'Permission denied: You do not have permission to manage doctor appointments.'
    });
  }

  // Circle-level fallback
  const permissions = req.circle.permissions || {};
  if (req.userRole === 'caretaker' && permissions.caretakerCanManageAppointments !== false) {
    return next();
  }
  if (req.userRole === 'family' && permissions.familyCanManageAppointments === true) {
    return next();
  }

  return res.status(403).json({
    success: false,
    error: 'Permission denied: You do not have permission to manage doctor appointments.'
  });
}

/**
 * Permission to view health readings (Health Guardian).
 */
export function requireViewReadingsPermission(req, res, next) {
  if (req.userRole === 'elder') return next();

  if (req.memberPermissions?.canViewReadings === false) {
    return res.status(403).json({
      success: false,
      error: 'Permission denied: You do not have permission to view simulated health readings.'
    });
  }

  const permissions = req.circle.permissions || {};
  if (req.userRole === 'family' && permissions.familyCanViewVitals === false) {
    return res.status(403).json({
      success: false,
      error: 'Permission denied: You do not have permission to view simulated health readings.'
    });
  }

  next();
}
