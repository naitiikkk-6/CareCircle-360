import { getDb } from '../db.js';

/**
 * Audit log recording who changed what in the Care Circle.
 * Visible to the elder on the sharing and permissions page.
 */
export async function logCircleActivity({ circleId, action, details, actor }) {
  try {
    const db = getDb();
    const logId = 'act_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    const entry = {
      id: logId,
      circleId,
      action,
      details: typeof details === 'string' ? details : JSON.stringify(details),
      actor: {
        uid: actor?.uid || 'system',
        name: actor?.name || 'System',
        role: actor?.role || 'system'
      },
      timestamp: new Date().toISOString()
    };

    await db.collection('activityLogs').doc(logId).set(entry);
    return entry;
  } catch (err) {
    console.error('Failed to log circle activity:', err);
    return null;
  }
}

/**
 * Retrieve chronological activity logs for a care circle.
 */
export async function getCircleActivityLogs(circleId, limit = 50) {
  const db = getDb();
  const snap = await db.collection('activityLogs')
    .where('circleId', '==', circleId)
    .get();

  const logs = [];
  snap.forEach(d => logs.push(d.data()));
  logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return logs.slice(0, limit);
}
