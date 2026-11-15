import express from 'express';
import { getDb } from '../db.js';
import { verifyAuthToken } from '../middleware/auth.js';
import { requireCircleAccess, requireViewReadingsPermission } from '../middleware/permissions.js';

const router = express.Router();

const SIMULATED_DATA_DISCLAIMER =
  'SIMULATED DEMO READINGS: This feature demonstrates vital trend visualization. These readings are synthetic/simulated for demonstration purposes only. There is NO real medical device or sensor connected.';

/**
 * Get simulated vitals history for the Health Guardian chart.
 */
router.get(
  '/vitals',
  verifyAuthToken,
  requireCircleAccess,
  requireViewReadingsPermission,
  async (req, res) => {
    try {
      const db = getDb();
      const vitalsSnap = await db
        .collection('simulatedVitals')
        .where('circleId', '==', req.circle.id)
        .get();

      const readings = [];
      vitalsSnap.forEach((d) => readings.push(d.data()));

      // If no readings exist, generate 7 days of realistic baseline simulated data
      if (readings.length === 0) {
        const now = new Date();
        for (let i = 6; i >= 0; i--) {
          const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
          const dateStr = d.toISOString().split('T')[0];

          // Slightly varying synthetic values within typical normal ranges
          const reading = {
            id: `vital_${req.circle.id}_${dateStr}`,
            circleId: req.circle.id,
            date: dateStr,
            timestamp: d.toISOString(),
            bloodPressureSystolic: 118 + Math.floor(Math.sin(i) * 6),
            bloodPressureDiastolic: 78 + Math.floor(Math.cos(i) * 4),
            heartRate: 72 + Math.floor(Math.sin(i * 2) * 5),
            bloodGlucose: 105 + Math.floor(Math.cos(i) * 10),
            spO2: 98,
            isSimulated: true,
            label: 'Simulated Demo Reading'
          };

          await db.collection('simulatedVitals').doc(reading.id).set(reading);
          readings.push(reading);
        }
      }

      readings.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      return res.json({
        success: true,
        readings,
        disclaimer: SIMULATED_DATA_DISCLAIMER,
        isSimulated: true
      });
    } catch (err) {
      console.error('Guardian vitals error:', err);
      return res.status(500).json({ success: false, error: 'Failed to retrieve vital trends.' });
    }
  }
);

/**
 * Add or refresh a simulated reading (for interactive testing).
 */
router.post(
  '/simulate-reading',
  verifyAuthToken,
  requireCircleAccess,
  requireViewReadingsPermission,
  async (req, res) => {
    try {
      const db = getDb();
      const now = new Date();
      const dateStr = now.toISOString().split('T')[0];

      const {
        systolic = 120,
        diastolic = 80,
        heartRate = 74,
        bloodGlucose = 110,
        spO2 = 98
      } = req.body;

      const newReading = {
        id: `vital_${req.circle.id}_${Date.now()}`,
        circleId: req.circle.id,
        date: dateStr,
        timestamp: now.toISOString(),
        bloodPressureSystolic: Number(systolic),
        bloodPressureDiastolic: Number(diastolic),
        heartRate: Number(heartRate),
        bloodGlucose: Number(bloodGlucose),
        spO2: Number(spO2),
        isSimulated: true,
        label: 'Simulated Demo Reading'
      };

      await db.collection('simulatedVitals').doc(newReading.id).set(newReading);

      return res.status(201).json({
        success: true,
        reading: newReading,
        disclaimer: SIMULATED_DATA_DISCLAIMER
      });
    } catch (err) {
      console.error('Record vitals error:', err);
      return res.status(500).json({ success: false, error: 'Failed to record simulated reading.' });
    }
  }
);

export default router;
