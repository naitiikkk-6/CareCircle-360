import express from 'express';
import { verifyAuthToken } from '../middleware/auth.js';
import { aiScanLimiter } from '../middleware/security.js';
import { analyzeMedicinePackaging } from '../services/geminiService.js';

const router = express.Router();

/**
 * MediGuide AI Packaging Scanner
 * Server-side Gemini API integration enforcing safety rules.
 */
router.post('/scan-packaging', verifyAuthToken, aiScanLimiter, async (req, res) => {
  try {
    const { packagingText, imageBase64, mimeType } = req.body;

    if (!packagingText && !imageBase64) {
      return res.status(400).json({
        success: false,
        error: 'Please provide packaging text or an image of the medicine box/foil.'
      });
    }

    const result = await analyzeMedicinePackaging({
      packagingText,
      imageBase64,
      mimeType
    });

    return res.json({
      success: true,
      analysis: result,
      safetyNotice: 'All extracted details are subject to user review. Verify against physical packaging.'
    });
  } catch (err) {
    console.error('AI Scan packaging error:', err);
    return res.status(500).json({
      success: false,
      error: 'MediGuide scan failed. Please verify with pharmacist or type details directly.'
    });
  }
});

export default router;
