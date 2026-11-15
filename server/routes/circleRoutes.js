import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { getDb } from '../db.js';
import { verifyAuthToken } from '../middleware/auth.js';
import { requireCircleAccess, requireElderOnly } from '../middleware/permissions.js';
import { passcodeJoinLimiter } from '../middleware/security.js';
import { logCircleActivity, getCircleActivityLogs } from '../services/activityService.js';
import { processWeeklySummaryForCircle } from '../services/weeklySummaryService.js';

const router = express.Router();

/**
 * List all care circles the authenticated user belongs to.
 */
router.get('/', verifyAuthToken, async (req, res) => {
  try {
    const db = getDb();
    const circlesSnap = await db.collection('careCircles').get();
    const myCircles = [];

    circlesSnap.forEach(doc => {
      const circle = doc.data();
      const isElder = circle.elderUid === req.user.uid;
      const member = (circle.members || []).find(m => m.uid === req.user.uid);

      if (isElder || member) {
        myCircles.push({
          id: circle.id,
          name: circle.name,
          elderName: circle.elderName,
          timezone: circle.timezone || 'Asia/Kolkata',
          myRole: isElder ? 'elder' : member.role,
          memberCount: (circle.members?.length || 0) + 1,
          createdAt: circle.createdAt
        });
      }
    });

    return res.json({ success: true, circles: myCircles });
  } catch (err) {
    console.error('List circles error:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve care circles.' });
  }
});

/**
 * Create a new Care Circle.
 * Inputs validated: name, elderName, passcode, timezone.
 * Creator is assigned the Elder role.
 */
router.post('/create', verifyAuthToken, async (req, res) => {
  try {
    const { name, elderName, passcode, timezone = 'Asia/Kolkata' } = req.body;

    // Strict input validation
    if (!name || typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 100) {
      return res.status(400).json({
        success: false,
        error: 'Care circle name must be between 2 and 100 characters.'
      });
    }

    if (!passcode || typeof passcode !== 'string' || passcode.length < 4 || passcode.length > 64) {
      return res.status(400).json({
        success: false,
        error: 'Join passcode must be between 4 and 64 characters long.'
      });
    }

    const salt = await bcrypt.genSalt(12);
    const passcodeHash = await bcrypt.hash(passcode, salt);

    const circleId = 'circle_' + Date.now().toString(36) + '_' + crypto.randomBytes(3).toString('hex');
    const db = getDb();

    const newCircle = {
      id: circleId,
      name: name.trim(),
      elderUid: req.user.uid,
      elderName: (elderName && typeof elderName === 'string' && elderName.trim()) || req.user.name,
      elderEmail: req.user.email,
      timezone: typeof timezone === 'string' ? timezone.trim() : 'Asia/Kolkata',
      passcodeHash, // NEVER sent to clients
      passcodeHint: `${passcode.length} characters`,
      members: [],
      permissions: {
        caretakerCanManageMeds: true,
        caretakerCanLogDoses: true,
        caretakerCanManageAppointments: true,
        familyCanLogDoses: false,
        familyCanManageMeds: false,
        familyCanManageAppointments: false,
        familyCanViewVitals: true
      },
      createdAt: new Date().toISOString()
    };

    await db.collection('careCircles').doc(circleId).set(newCircle);

    const sanitized = { ...newCircle };
    delete sanitized.passcodeHash;

    return res.status(201).json({
      success: true,
      message: 'Care circle created successfully.',
      circle: sanitized
    });
  } catch (err) {
    console.error('Create circle error:', err);
    return res.status(500).json({ success: false, error: 'Failed to create care circle.' });
  }
});

/**
 * Join an existing Care Circle using its ID and passcode.
 * Rate limited to 5 attempts per 10 minutes (per IP) to stop brute-forcing.
 * Uses timing-safe constant-time hash comparison.
 */
router.post('/join', verifyAuthToken, passcodeJoinLimiter, async (req, res) => {
  try {
    const { circleId, passcode, role = 'family' } = req.body;

    // Strict input validation
    if (!circleId || typeof circleId !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Care circle identifier (circleId) is required.'
      });
    }

    if (!passcode || typeof passcode !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Passcode is required to join.'
      });
    }

    if (!['caretaker', 'family'].includes(role)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid join role. Must be "caretaker" or "family".'
      });
    }

    const db = getDb();
    const circleDoc = await db.collection('careCircles').doc(circleId.trim()).get();

    if (!circleDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Care circle not found with the provided identifier.'
      });
    }

    const circle = circleDoc.data();

    // Prevent elder from demoting themselves or joining as a non-owner
    if (circle.elderUid === req.user.uid) {
      return res.status(400).json({
        success: false,
        error: 'You are already the Elder owner of this Care Circle.'
      });
    }

    // Constant-time passcode verification via bcrypt
    const isPasscodeValid = await bcrypt.compare(passcode, circle.passcodeHash);

    // Explicit constant-time comparison safeguard
    const expectedBuffer = Buffer.from(circle.passcodeHash, 'utf8');
    const computedHash = isPasscodeValid ? circle.passcodeHash : await bcrypt.hash('dummy_invalid_timing_defense', 10);
    const computedBuffer = Buffer.from(computedHash, 'utf8');
    const timingMatch = (expectedBuffer.length === computedBuffer.length) && crypto.timingSafeEqual(expectedBuffer, computedBuffer);

    if (!isPasscodeValid || !timingMatch) {
      return res.status(401).json({
        success: false,
        error: 'Incorrect passcode. Please request the verified passcode from the Elder.'
      });
    }

    // Role assignment & member registration
    const members = circle.members || [];
    const existingIndex = members.findIndex(m => m.uid === req.user.uid);

    const memberRecord = {
      uid: req.user.uid,
      name: req.user.name,
      email: req.user.email,
      role,
      joinedAt: new Date().toISOString()
    };

    if (existingIndex >= 0) {
      members[existingIndex] = { ...members[existingIndex], role };
    } else {
      members.push(memberRecord);
    }

    await db.collection('careCircles').doc(circle.id).update({ members });

    return res.json({
      success: true,
      message: `Successfully joined ${circle.name} as ${role}.`,
      circle: {
        id: circle.id,
        name: circle.name,
        elderName: circle.elderName,
        myRole: role
      }
    });
  } catch (err) {
    console.error('Join circle error:', err);
    return res.status(500).json({ success: false, error: 'Failed to join care circle.' });
  }
});

/**
 * Get details of a single care circle.
 * Verified by requireCircleAccess middleware (cross-circle access rejected with 403).
 */
router.get('/:circleId', verifyAuthToken, requireCircleAccess, (req, res) => {
  const sanitized = { ...req.circle };
  delete sanitized.passcodeHash;
  return res.json({
    success: true,
    circle: sanitized,
    userRole: req.userRole,
    isElder: req.isElder
  });
});

/**
 * Update circle permissions (ELDER ONLY).
 * Strict input validation on permissions object.
 */
const updateCirclePermissionsHandler = async (req, res) => {
  try {
    const { permissions } = req.body;
    if (!permissions || typeof permissions !== 'object') {
      return res.status(400).json({ success: false, error: 'Valid permissions object is required.' });
    }

    const currentPerms = req.circle.permissions || {};
    const updatedPermissions = {
      ...currentPerms,
      caretakerCanManageMeds: permissions.caretakerCanManageMeds !== undefined
        ? Boolean(permissions.caretakerCanManageMeds)
        : currentPerms.caretakerCanManageMeds ?? true,
      caretakerCanLogDoses: permissions.caretakerCanLogDoses !== undefined
        ? Boolean(permissions.caretakerCanLogDoses)
        : currentPerms.caretakerCanLogDoses ?? true,
      caretakerCanManageAppointments: permissions.caretakerCanManageAppointments !== undefined
        ? Boolean(permissions.caretakerCanManageAppointments)
        : currentPerms.caretakerCanManageAppointments ?? true,
      familyCanLogDoses: permissions.familyCanLogDoses !== undefined
        ? Boolean(permissions.familyCanLogDoses)
        : currentPerms.familyCanLogDoses ?? false,
      familyCanManageMeds: permissions.familyCanManageMeds !== undefined
        ? Boolean(permissions.familyCanManageMeds)
        : currentPerms.familyCanManageMeds ?? false,
      familyCanManageAppointments: permissions.familyCanManageAppointments !== undefined
        ? Boolean(permissions.familyCanManageAppointments)
        : currentPerms.familyCanManageAppointments ?? false,
      familyCanViewVitals: permissions.familyCanViewVitals !== undefined
        ? Boolean(permissions.familyCanViewVitals)
        : currentPerms.familyCanViewVitals ?? true,
      familyCanReceiveWeeklySummary: permissions.familyCanReceiveWeeklySummary !== undefined
        ? Boolean(permissions.familyCanReceiveWeeklySummary)
        : currentPerms.familyCanReceiveWeeklySummary ?? true,
      caretakerCanReceiveWeeklySummary: permissions.caretakerCanReceiveWeeklySummary !== undefined
        ? Boolean(permissions.caretakerCanReceiveWeeklySummary)
        : currentPerms.caretakerCanReceiveWeeklySummary ?? true
    };

    const db = getDb();
    const circleUpdates = { permissions: updatedPermissions };

    if (req.body.caretakerEscalationDelayMinutes !== undefined) {
      circleUpdates.caretakerEscalationDelayMinutes = Math.max(1, parseInt(req.body.caretakerEscalationDelayMinutes, 10) || 15);
    }
    if (req.body.familyEscalationDelayMinutes !== undefined) {
      circleUpdates.familyEscalationDelayMinutes = Math.max(1, parseInt(req.body.familyEscalationDelayMinutes, 10) || 30);
    }

    await db.collection('careCircles').doc(req.circle.id).update(circleUpdates);

    await logCircleActivity({
      circleId: req.circle.id,
      action: 'PERMISSIONS_UPDATED',
      details: 'Elder updated care circle sharing permissions and escalation policy',
      actor: req.user
    });

    return res.json({
      success: true,
      message: 'Care Circle permissions successfully updated by Elder.',
      permissions: updatedPermissions,
      caretakerEscalationDelayMinutes: circleUpdates.caretakerEscalationDelayMinutes,
      familyEscalationDelayMinutes: circleUpdates.familyEscalationDelayMinutes
    });
  } catch (err) {
    console.error('Update permissions error:', err);
    return res.status(500).json({ success: false, error: 'Failed to update circle permissions.' });
  }
};

router.put('/:circleId/permissions', verifyAuthToken, requireCircleAccess, requireElderOnly, updateCirclePermissionsHandler);
router.put('/permissions', verifyAuthToken, requireCircleAccess, requireElderOnly, updateCirclePermissionsHandler);

/**
 * Update circle passcode (ELDER ONLY).
 */
router.put('/:circleId/passcode', verifyAuthToken, requireCircleAccess, requireElderOnly, async (req, res) => {
  try {
    const { newPasscode } = req.body;
    if (!newPasscode || typeof newPasscode !== 'string' || newPasscode.length < 4 || newPasscode.length > 64) {
      return res.status(400).json({
        success: false,
        error: 'New passcode must be between 4 and 64 characters long.'
      });
    }

    const salt = await bcrypt.genSalt(12);
    const passcodeHash = await bcrypt.hash(newPasscode, salt);

    const db = getDb();
    await db.collection('careCircles').doc(req.circle.id).update({
      passcodeHash,
      passcodeHint: `${newPasscode.length} characters`
    });

    await logCircleActivity({
      circleId: req.circle.id,
      action: 'PASSCODE_CHANGED',
      details: 'Elder updated join passcode',
      actor: req.user
    });

    return res.json({
      success: true,
      message: 'Circle passcode updated securely. Share the new passcode with trusted circle members.'
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to update passcode.' });
  }
});

/**
 * Update sharing permissions for an individual member (ELDER ONLY).
 * Controls what they can view (medicines, doses, appts, readings),
 * what they can edit, and what email alerts they receive.
 */
router.put('/:circleId/members/:memberUid/permissions', verifyAuthToken, requireCircleAccess, requireElderOnly, async (req, res) => {
  try {
    const { memberUid } = req.params;
    const { permissions } = req.body;

    if (!permissions || typeof permissions !== 'object') {
      return res.status(400).json({ success: false, error: 'Valid permissions object is required.' });
    }

    const members = req.circle.members || [];
    const memberIndex = members.findIndex(m => m.uid === memberUid);

    if (memberIndex === -1) {
      return res.status(404).json({ success: false, error: 'Member not found in this care circle.' });
    }

    const currentMember = members[memberIndex];
    const currentMemberPerms = currentMember.permissions || {};

    const updatedPermissions = {
      ...currentMemberPerms,
      canViewMedicines: permissions.canViewMedicines !== undefined ? Boolean(permissions.canViewMedicines) : currentMemberPerms.canViewMedicines ?? true,
      canViewDoses: permissions.canViewDoses !== undefined ? Boolean(permissions.canViewDoses) : currentMemberPerms.canViewDoses ?? true,
      canViewAppointments: permissions.canViewAppointments !== undefined ? Boolean(permissions.canViewAppointments) : currentMemberPerms.canViewAppointments ?? true,
      canViewReadings: permissions.canViewReadings !== undefined ? Boolean(permissions.canViewReadings) : currentMemberPerms.canViewReadings ?? true,
      canEditMedicines: permissions.canEditMedicines !== undefined ? Boolean(permissions.canEditMedicines) : currentMemberPerms.canEditMedicines ?? (currentMember.role === 'caretaker'),
      canEditDoses: permissions.canEditDoses !== undefined ? Boolean(permissions.canEditDoses) : currentMemberPerms.canEditDoses ?? (currentMember.role === 'caretaker'),
      canEditAppointments: permissions.canEditAppointments !== undefined ? Boolean(permissions.canEditAppointments) : currentMemberPerms.canEditAppointments ?? (currentMember.role === 'caretaker'),
      alertIntakeReminders: permissions.alertIntakeReminders !== undefined ? Boolean(permissions.alertIntakeReminders) : currentMemberPerms.alertIntakeReminders ?? (currentMember.role === 'caretaker'),
      alertMissedDoses: permissions.alertMissedDoses !== undefined ? Boolean(permissions.alertMissedDoses) : currentMemberPerms.alertMissedDoses ?? true,
      alertAppointments: permissions.alertAppointments !== undefined ? Boolean(permissions.alertAppointments) : currentMemberPerms.alertAppointments ?? true,
      alertWeeklySummary: permissions.alertWeeklySummary !== undefined ? Boolean(permissions.alertWeeklySummary) : currentMemberPerms.alertWeeklySummary ?? true
    };

    members[memberIndex] = {
      ...currentMember,
      permissions: updatedPermissions
    };

    const db = getDb();
    await db.collection('careCircles').doc(req.circle.id).update({ members });

    await logCircleActivity({
      circleId: req.circle.id,
      action: 'MEMBER_PERMISSIONS_UPDATED',
      details: `Elder updated permissions for ${currentMember.name || currentMember.email} (${currentMember.role})`,
      actor: req.user
    });

    return res.json({
      success: true,
      message: `Permissions updated for ${currentMember.name || currentMember.email}.`,
      member: members[memberIndex]
    });
  } catch (err) {
    console.error('Update member permissions error:', err);
    return res.status(500).json({ success: false, error: 'Failed to update member permissions.' });
  }
});

/**
 * Revoke member access immediately (ELDER ONLY).
 * Instantaneous server-side enforcement on all routes.
 */
router.post('/:circleId/members/:memberUid/revoke', verifyAuthToken, requireCircleAccess, requireElderOnly, async (req, res) => {
  try {
    const { memberUid } = req.params;
    const members = req.circle.members || [];
    const memberIndex = members.findIndex(m => m.uid === memberUid);

    if (memberIndex === -1) {
      return res.status(404).json({ success: false, error: 'Member not found in this care circle.' });
    }

    const currentMember = members[memberIndex];
    members[memberIndex] = {
      ...currentMember,
      isRevoked: true,
      revokedAt: new Date().toISOString()
    };

    const db = getDb();
    await db.collection('careCircles').doc(req.circle.id).update({ members });

    await logCircleActivity({
      circleId: req.circle.id,
      action: 'MEMBER_REVOKED',
      details: `Elder revoked access for ${currentMember.name || currentMember.email}`,
      actor: req.user
    });

    return res.json({
      success: true,
      message: `Access for ${currentMember.name || currentMember.email} has been revoked immediately.`,
      member: members[memberIndex]
    });
  } catch (err) {
    console.error('Revoke member error:', err);
    return res.status(500).json({ success: false, error: 'Failed to revoke member access.' });
  }
});

/**
 * Restore previously revoked member access (ELDER ONLY).
 */
router.post('/:circleId/members/:memberUid/restore', verifyAuthToken, requireCircleAccess, requireElderOnly, async (req, res) => {
  try {
    const { memberUid } = req.params;
    const members = req.circle.members || [];
    const memberIndex = members.findIndex(m => m.uid === memberUid);

    if (memberIndex === -1) {
      return res.status(404).json({ success: false, error: 'Member not found in this care circle.' });
    }

    const currentMember = members[memberIndex];
    members[memberIndex] = {
      ...currentMember,
      isRevoked: false,
      restoredAt: new Date().toISOString()
    };

    const db = getDb();
    await db.collection('careCircles').doc(req.circle.id).update({ members });

    await logCircleActivity({
      circleId: req.circle.id,
      action: 'MEMBER_RESTORED',
      details: `Elder restored access for ${currentMember.name || currentMember.email}`,
      actor: req.user
    });

    return res.json({
      success: true,
      message: `Access for ${currentMember.name || currentMember.email} has been restored.`,
      member: members[memberIndex]
    });
  } catch (err) {
    console.error('Restore member error:', err);
    return res.status(500).json({ success: false, error: 'Failed to restore member access.' });
  }
});

/**
 * Activity log showing who changed what in the circle (ELDER ONLY or Circle Members).
 */
router.get('/:circleId/activity-log', verifyAuthToken, requireCircleAccess, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '50', 10);
    const logs = await getCircleActivityLogs(req.circle.id, limit);

    return res.json({
      success: true,
      circleId: req.circle.id,
      logs
    });
  } catch (err) {
    console.error('Activity log error:', err);
    return res.status(500).json({ success: false, error: 'Failed to retrieve activity log.' });
  }
});

/**
 * Get Weekly Family Summary for the circle.
 * Computes 7-day adherence, missed doses grouped by time of day slot (morning/afternoon/evening/night),
 * and generates 3 to 5 plain sentences using Gemini with safe template fallback.
 */
router.get('/:circleId/weekly-summary', verifyAuthToken, requireCircleAccess, async (req, res) => {
  try {
    const referenceDate = req.query.referenceDate ? new Date(req.query.referenceDate) : null;
    const summary = await processWeeklySummaryForCircle({
      circle: req.circle,
      referenceDateObj: referenceDate,
      sendEmail: false
    });

    return res.json({
      success: true,
      summary
    });
  } catch (err) {
    console.error('Get weekly summary error:', err);
    return res.status(500).json({ success: false, error: 'Failed to generate weekly family summary.' });
  }
});

/**
 * Dispatch Weekly Family Summary Email to allowed circle members.
 */
router.post('/:circleId/weekly-summary/send', verifyAuthToken, requireCircleAccess, async (req, res) => {
  try {
    const referenceDate = req.body?.referenceDate ? new Date(req.body.referenceDate) : null;
    const result = await processWeeklySummaryForCircle({
      circle: req.circle,
      referenceDateObj: referenceDate,
      sendEmail: true,
      forceSend: true
    });

    return res.json({
      success: true,
      message: `Weekly summary successfully dispatched to ${result.emailsSent} allowed recipient(s).`,
      summary: result
    });
  } catch (err) {
    console.error('Send weekly summary error:', err);
    return res.status(500).json({ success: false, error: 'Failed to dispatch weekly family summary.' });
  }
});

export default router;
