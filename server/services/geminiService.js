import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config.js';

let genAI = null;

function getGeminiClient() {
  if (genAI) return genAI;
  if (config.geminiApiKey) {
    try {
      genAI = new GoogleGenerativeAI(config.geminiApiKey);
      return genAI;
    } catch (err) {
      console.warn('Failed to initialize Gemini client:', err.message);
    }
  }
  return null;
}

const SAFETY_DISCLAIMER =
  'CareCircle 360 AI Safety Protocol: Information is derived strictly from packaging text. Never take or alter medication without consulting a certified doctor or licensed pharmacist.';

/**
 * Server-side MediGuide AI packaging text scanner and analyzer.
 * Accepts either extracted packaging text or image base64.
 */
/**
 * Extracts visible medicine details from packaging text or image using Gemini 1.5 Flash.
 * Enforces strict safety bounding: never invents information or gives medical recommendations.
 *
 * @param {Object} params
 * @param {string} [params.packagingText] - Raw text detected on the packaging.
 * @param {string} [params.imageBase64] - Base64-encoded image data.
 * @param {string} [params.mimeType='image/jpeg'] - MIME type of the uploaded image.
 * @returns {Promise<Object>} Extracted metadata with verified source labels and disclaimers.
 */
export async function analyzeMedicinePackaging({
  packagingText,
  imageBase64,
  mimeType = 'image/jpeg'
}) {
  const client = getGeminiClient();

  const systemInstructions = `
You are the MediGuide AI packaging text extractor for CareCircle 360, an elderly care platform.
STRICT SAFETY RULES YOU MUST ENFORCE:
1. NEVER identify a medicine from appearance, color, or shape alone. Only extract readable TEXT on the packaging.
2. If text is illegible or unclear, indicate that text could not be verified.
3. NEVER invent dosage instructions. Never recommend medicines. Never decide whether someone should take a medicine.
4. NEVER guess whether milk, water, or food is appropriate unless explicitly printed on the package text.
5. Every field MUST have a sourceLabel: exactly either "From the packaging" or "Not verified - ask your pharmacist or doctor". Never label anything verified unless directly read from the package.
6. Always return valid JSON conforming to this schema:
{
  "medicineName": string,
  "medicineNameSource": "From the packaging" | "Not verified - ask your pharmacist or doctor",
  "activeIngredients": string,
  "strength": string,
  "strengthSource": "From the packaging" | "Not verified - ask your pharmacist or doctor",
  "packagingInstructions": string,
  "instructionsSource": "From the packaging" | "Not verified - ask your pharmacist or doctor",
  "foodOrLiquidNotice": string,
  "foodNoticeSource": "From the packaging" | "Not verified - ask your pharmacist or doctor",
  "expiryOrBatch": string,
  "requiresUserConfirmation": true,
  "safetyWarning": "${SAFETY_DISCLAIMER}"
}
`;

  if (client) {
    try {
      const model = client.getGenerativeModel({
        model: 'gemini-1.5-flash',
        systemInstruction: systemInstructions
      });

      const prompt = `Extract all visible medicine packaging details from the provided text or image according to the strict safety schema.`;
      const parts = [{ text: prompt }];

      if (packagingText) {
        parts.push({ text: `Package Text to analyze:\n${packagingText}` });
      }

      if (imageBase64) {
        // Strip data prefix if present
        const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
        parts.push({
          inlineData: {
            data: cleanBase64,
            mimeType
          }
        });
      }

      if (parts.length === 0) {
        parts.push({ text: 'No text or image provided.' });
      }

      const result = await model.generateContent(parts);
      const response = await result.response;
      const text = response.text();

      // Extract JSON block
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        parsed.requiresUserConfirmation = true;
        parsed.safetyWarning = SAFETY_DISCLAIMER;
        return parsed;
      }
    } catch (err) {
      console.error('Gemini API call error:', err.message);
      // Fall through to safe offline parsing
    }
  }

  // Safe fallback analyzer for offline evaluation, testing, or when API key is unset
  return safeFallbackPackagingAnalysis(packagingText || '');
}

/**
 * Deterministic safe parser that strictly abides by all safety rules.
 */
function safeFallbackPackagingAnalysis(rawText) {
  const text = rawText.trim();
  if (!text) {
    return {
      medicineName: 'Unidentified Medicine',
      medicineNameSource: 'Not verified - ask your pharmacist or doctor',
      activeIngredients: 'Not stated on packaging input',
      strength: 'Not verified - ask your pharmacist or doctor',
      strengthSource: 'Not verified - ask your pharmacist or doctor',
      packagingInstructions: 'Not verified - ask your pharmacist or doctor',
      instructionsSource: 'Not verified - ask your pharmacist or doctor',
      foodOrLiquidNotice: 'Not verified - ask your pharmacist or doctor',
      foodNoticeSource: 'Not verified - ask your pharmacist or doctor',
      expiryOrBatch: 'None detected',
      requiresUserConfirmation: true,
      safetyWarning: SAFETY_DISCLAIMER,
      mode: 'Offline Safe Scanner'
    };
  }

  // Look for common packaging patterns in the user-provided text
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const firstLine = lines[0] || 'Unknown';

  // Extract strength pattern like 500mg, 10mg, 5ml
  const strengthMatch = text.match(/\b\d+(\.\d+)?\s*(mg|mcg|ml|g|iu)\b/i);
  const strength = strengthMatch ? strengthMatch[0] : null;

  // Extract food notes only if explicitly in text
  let foodNotice = null;
  if (/after\s+(food|meals?)/i.test(text)) {
    foodNotice = 'Take after meals (printed on packaging)';
  } else if (/before\s+(food|meals?)/i.test(text)) {
    foodNotice = 'Take before meals (printed on packaging)';
  } else if (/with\s+(food|meals?)/i.test(text)) {
    foodNotice = 'Take with food (printed on packaging)';
  }

  return {
    medicineName: firstLine,
    medicineNameSource: 'From the packaging',
    activeIngredients: lines[1] ? lines[1] : 'Not specified on packaging',
    strength: strength || 'Not verified - ask your pharmacist or doctor',
    strengthSource: strength
      ? 'From the packaging'
      : 'Not verified - ask your pharmacist or doctor',
    packagingInstructions:
      lines.length > 2 ? lines.slice(2).join('; ') : 'Not verified - ask your pharmacist or doctor',
    instructionsSource:
      lines.length > 2 ? 'From the packaging' : 'Not verified - ask your pharmacist or doctor',
    foodOrLiquidNotice: foodNotice || 'Not verified - ask your pharmacist or doctor',
    foodNoticeSource: foodNotice
      ? 'From the packaging'
      : 'Not verified - ask your pharmacist or doctor',
    expiryOrBatch:
      text.match(/(exp|expiry|batch|lot)[\s:]*([a-z0-9/-]+)/i)?.[0] ||
      'Not verified - ask your pharmacist or doctor',
    requiresUserConfirmation: true,
    safetyWarning: SAFETY_DISCLAIMER,
    mode: 'Safe Packaging Text Parser'
  };
}

/**
 * Deterministic safe template fallback summary when Gemini is unreachable or API key is absent.
 * Produces exactly 3 to 5 plain sentences for family with no medical advice.
 *
 * @param {Object} params
 * @param {string} params.elderName - First name of the elder.
 * @param {number} params.adherenceRate - Adherence percentage (0-100).
 * @param {number} params.takenCount - Total doses taken in the week.
 * @param {number} params.missedCount - Total doses missed in the week.
 * @param {number} params.totalDue - Total doses scheduled/due in the week.
 * @param {Object} params.missedByTimeOfDay - Missed dose count keyed by slot ('morning', 'afternoon', 'evening', 'night').
 * @param {string} [params.mostMissedSlot] - Slot with highest missed count.
 * @returns {string} Plain-text 3 to 5 sentence summary for family members.
 */
export function generateTemplateWeeklySummary({
  elderFirstName,
  adherenceRate,
  totalDue,
  takenCount,
  missedCount,
  missedByTimeOfDay = {},
  mostMissedSlot = null
}) {
  const name = elderFirstName || 'Your elder';
  const sentences = [];

  // Sentence 1: Overall adherence and doses taken
  sentences.push(
    `Over the past week, ${name} completed ${takenCount} of ${totalDue} scheduled doses, reaching an overall adherence rate of ${adherenceRate}%.`
  );

  // Sentence 2: Pattern of missed doses by time of day
  if (missedCount === 0) {
    sentences.push(
      `All scheduled medications were taken on time throughout the entire week with zero missed doses.`
    );
  } else if (mostMissedSlot && missedByTimeOfDay[mostMissedSlot] > 0) {
    const slotCount = missedByTimeOfDay[mostMissedSlot];
    sentences.push(
      `Of the ${missedCount} missed doses this week, the most frequent missed time was during the ${mostMissedSlot} hours (${slotCount} missed).`
    );
  } else {
    sentences.push(`There were ${missedCount} missed doses noted over the course of the week.`);
  }

  // Sentence 3: Reassurance on consistency
  sentences.push(
    `Consistent daily timing helps maintain steady health benefits and everyday peace of mind.`
  );

  // Sentence 4: Encouragement for family check-in
  if (missedCount > 0 && mostMissedSlot) {
    sentences.push(
      `A warm family check-in around ${mostMissedSlot} time can be a helpful and encouraging reminder.`
    );
  } else {
    sentences.push(
      `Please continue sharing warm encouragement and celebrating this consistent routine.`
    );
  }

  return sentences.join(' ');
}

/**
 * Turns weekly adherence numbers into 3 to 5 plain sentences for family using Gemini.
 * Follows strict safety constraints:
 * - Only numbers and first name provided.
 * - Explicitly instructed NOT to give medical advice or suggest changing medicines.
 * - Falls back to generateTemplateWeeklySummary on any error or missing key.
 *
 * @param {Object} params
 * @param {string} params.elderFirstName - First name of the elder.
 * @param {number} params.adherenceRate - Adherence percentage.
 * @param {number} params.totalDue - Total doses scheduled.
 * @param {number} params.takenCount - Doses confirmed taken.
 * @param {number} params.missedCount - Doses confirmed missed.
 * @param {Object} params.missedByTimeOfDay - Counts per slot (morning, afternoon, evening, night).
 * @param {string} params.mostMissedSlot - Most frequently missed slot.
 * @returns {Promise<string>} 3 to 5 natural language summary sentences.
 */
export async function generateWeeklyFamilySummaryWithGemini({
  elderFirstName,
  adherenceRate,
  totalDue,
  takenCount,
  missedCount,
  missedByTimeOfDay = {},
  mostMissedSlot = null
}) {
  const client = getGeminiClient();
  const firstName = (elderFirstName || 'Elder').trim().split(' ')[0];

  const systemInstructions = `
You are CareCircle 360's family update writer.
Your job is to translate weekly medication adherence numbers into a warm, readable digest for the elder's family circle.
STRICT SAFETY & PRIVACY CONSTRAINTS:
1. Write exactly 3 to 5 clear, plain English sentences. Do not use bullet points, markdown titles, or medical jargon.
2. Use ONLY the elder's first name (${firstName}). Never ask for or mention last names, diagnoses, or specific conditions.
3. NEVER give medical advice, suggest changing medications, recommend altering doses, or offer clinical opinions.
4. Mention the overall adherence percentage and which time of day (morning, afternoon, evening, or night) had the most missed doses if any.
5. If there are zero missed doses, offer warm praise for their consistency.
6. The tone must be compassionate, reassuring, and family-friendly.
`;

  if (client) {
    try {
      const model = client.getGenerativeModel({
        model: 'gemini-1.5-flash',
        systemInstruction: systemInstructions
      });

      const prompt = `
Numbers to summarize for the family of ${firstName}:
- First Name: ${firstName}
- 7-Day Adherence Rate: ${adherenceRate}%
- Total Doses Scheduled: ${totalDue}
- Doses Confirmed Taken: ${takenCount}
- Doses Missed: ${missedCount}
- Missed Doses by Time of Day: Morning: ${missedByTimeOfDay.morning || 0}, Afternoon: ${missedByTimeOfDay.afternoon || 0}, Evening: ${missedByTimeOfDay.evening || 0}, Night: ${missedByTimeOfDay.night || 0}
- Slot Most Often Missed: ${mostMissedSlot || 'None'}

Please write 3 to 5 plain sentences for the family summary. Do not give any medical advice or suggest altering prescriptions.
`;

      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text()?.trim();

      if (text && text.length > 20) {
        return {
          summaryText: text,
          generatedBy: 'gemini',
          model: 'gemini-1.5-flash'
        };
      }
    } catch (err) {
      console.warn(
        'Gemini weekly family summary failed, falling back to safe template:',
        err.message
      );
    }
  }

  // Safe template fallback
  return {
    summaryText: generateTemplateWeeklySummary({
      elderFirstName: firstName,
      adherenceRate,
      totalDue,
      takenCount,
      missedCount,
      missedByTimeOfDay,
      mostMissedSlot
    }),
    generatedBy: 'template-fallback',
    model: 'deterministic-template'
  };
}
