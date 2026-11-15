import nodemailer from 'nodemailer';
import { config } from '../config.js';

let transporter = null;
export let sentEmailsLog = []; // In-memory audit log for verification in tests and dashboard

/**
 * Clears the in-memory sent email audit log (used between test runs).
 */
export function clearSentEmailsLog() {
  sentEmailsLog = [];
}

/**
 * Returns a copy of the in-memory sent email audit log.
 *
 * @returns {Array<Object>} Logged email records.
 */
export function getSentEmailsLog() {
  return [...sentEmailsLog];
}

function getTransporter() {
  if (config.emailMockMode) {
    return null;
  }

  if (transporter) return transporter;

  if (config.smtp.user && config.smtp.pass) {
    try {
      transporter = nodemailer.createTransport({
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.secure,
        auth: {
          user: config.smtp.user,
          pass: config.smtp.pass
        }
      });
      return transporter;
    } catch (err) {
      console.warn('Failed to initialize live SMTP transporter:', err.message);
    }
  }

  return null;
}

/**
 * Dispatches an email via SMTP or records it in the in-memory mock log.
 *
 * @param {Object} options
 * @param {string} options.to - Recipient email.
 * @param {string} options.subject - Email subject line.
 * @param {string} [options.html] - HTML email body.
 * @param {string} [options.text] - Plain text email body.
 * @returns {Promise<{ success: boolean, messageId?: string, simulated?: boolean, mock?: boolean, error?: string }>}
 */
export async function sendEmail({ to, subject, html, text }) {
  const mailRecord = {
    from: config.smtp.from,
    to,
    subject,
    text: text || (html ? html.replace(/<[^>]*>/g, '').trim() : ''),
    html: html || `<p>${text || subject}</p>`,
    timestamp: new Date().toISOString()
  };

  sentEmailsLog.push(mailRecord);
  if (sentEmailsLog.length > 200) sentEmailsLog.shift();

  // Safe mock mode for local development and automated tests
  if (config.emailMockMode) {
    return {
      success: true,
      simulated: true,
      mock: true,
      messageId: `mock_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
    };
  }

  const liveTransporter = getTransporter();
  if (liveTransporter) {
    try {
      const info = await liveTransporter.sendMail({
        from: mailRecord.from,
        to: mailRecord.to,
        subject: mailRecord.subject,
        text: mailRecord.text,
        html: mailRecord.html
      });
      return { success: true, messageId: info.messageId, simulated: false };
    } catch (err) {
      console.error(`[Email Error] Failed sending to ${to}:`, err.message);
      return { success: false, error: err.message, simulated: false };
    }
  }

  return { success: true, simulated: true, mock: true };
}

/**
 * Plain, clear upcoming dose reminder email.
 * Includes medicine name, scheduled time, and who it is for.
 * Does not include sensitive health details beyond what is needed.
 */
export async function sendUpcomingDoseReminder({
  to,
  elderName,
  medicineName,
  strength,
  scheduledTime,
  instructions
}) {
  const subject = `Medication Reminder: ${elderName} - ${medicineName} at ${scheduledTime}`;
  const plainText = [
    `Hello,`,
    ``,
    `This is a reminder that ${elderName} is scheduled to take ${medicineName} (${strength || 'standard dose'}) today at ${scheduledTime}.`,
    instructions ? `Packaging note: ${instructions}` : '',
    ``,
    `Please record the dose as Taken in CareCircle 360 once completed.`,
    ``,
    `- CareCircle 360`
  ]
    .filter(Boolean)
    .join('\n');

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: auto; padding: 24px; border: 1px solid #dadce0; border-radius: 8px;">
      <h2 style="color: #0b57d0; margin-top: 0;">Medication Reminder</h2>
      <p style="font-size: 16px; color: #1f1f1f;">This is a reminder that <strong>${elderName}</strong> is scheduled to take medication:</p>
      <div style="background-color: #e8f0fe; padding: 16px; border-radius: 6px; margin: 16px 0;">
        <p style="margin: 4px 0; font-size: 16px;"><strong>Medicine:</strong> ${medicineName}</p>
        <p style="margin: 4px 0; font-size: 15px;"><strong>Dose / Strength:</strong> ${strength || 'As indicated on packaging'}</p>
        <p style="margin: 4px 0; font-size: 15px;"><strong>Scheduled Time:</strong> ${scheduledTime}</p>
        ${instructions ? `<p style="margin: 4px 0; font-size: 14px; color: #444;"><strong>Instructions:</strong> ${instructions}</p>` : ''}
      </div>
      <p style="font-size: 14px; color: #5f6368;">Please confirm and log the dose in CareCircle 360 once taken.</p>
    </div>
  `;

  return sendEmail({ to, subject, text: plainText, html });
}

/**
 * Plain, clear missed dose escalation alert.
 * Includes medicine name, scheduled time, and who it is for.
 * For the elder, includes a one-click confirmation link with an HMAC signed expiring token.
 */
export async function sendMissedDoseEscalation({
  to,
  elderName,
  medicineName,
  strength,
  scheduledTime,
  circleName,
  confirmUrl = null,
  tier = 1
}) {
  const subject = `Missed Medication Alert: ${elderName} - ${medicineName} (${scheduledTime})`;

  const plainText = [
    `CareCircle Alert: Missed Medication (Escalation Tier ${tier})`,
    ``,
    `A scheduled dose of ${medicineName} (${strength || 'standard dose'}) at ${scheduledTime} was not recorded as taken for ${elderName}.`,
    confirmUrl ? `` : null,
    confirmUrl
      ? `If you have already taken this medicine, click this secure link to confirm with one click:`
      : null,
    confirmUrl ? confirmUrl : null,
    confirmUrl ? `(This link expires in 24 hours and uses a secure signed token)` : null,
    ``,
    tier > 1
      ? `Please check in with ${elderName} to verify their well-being and assist if necessary.`
      : `Please record the dose as Taken as soon as you have taken it.`,
    ``,
    `- CareCircle 360 (${circleName || 'Family Care Circle'})`
  ]
    .filter((line) => line !== null)
    .join('\n');

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: auto; padding: 24px; border: 2px solid #d93025; border-radius: 8px;">
      <h2 style="color: #d93025; margin-top: 0;">⚠️ Missed Medication Alert</h2>
      <p style="font-size: 16px; color: #1f1f1f;">A scheduled dose was not confirmed within the grace window for <strong>${elderName}</strong>:</p>
      <div style="background-color: #fce8e6; padding: 16px; border-radius: 6px; margin: 16px 0; border-left: 4px solid #d93025;">
        <p style="margin: 4px 0; font-size: 16px;"><strong>Medicine:</strong> ${medicineName}</p>
        <p style="margin: 4px 0; font-size: 15px;"><strong>Scheduled Time:</strong> ${scheduledTime}</p>
        <p style="margin: 4px 0; font-size: 14px; color: #c5221f;"><strong>Status:</strong> Marked as Overdue / Missed (Tier ${tier})</p>
      </div>
      ${
        confirmUrl
          ? `
        <div style="text-align: center; margin: 24px 0;">
          <a href="${confirmUrl}" style="background-color: #0b57d0; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block; font-size: 16px;">
            ✓ I Have Taken This Dose
          </a>
          <p style="font-size: 12px; color: #5f6368; margin-top: 8px;">One-click secure confirmation link (expires in 24 hours)</p>
        </div>
      `
          : ''
      }
      <p style="font-size: 14px; color: #3c4043;">
        ${tier > 1 ? `Please check in with ${elderName} or their primary caretaker to ensure their health and safety.` : `Please confirm and log the dose in CareCircle 360 or click the button above.`}
      </p>
    </div>
  `;

  return sendEmail({ to, subject, text: plainText, html });
}

/**
 * Plain, clear doctor appointment reminder email.
 */
export async function sendAppointmentReminder({
  to,
  elderName,
  doctorName,
  purpose,
  appointmentTime,
  place
}) {
  const docTitle =
    doctorName.startsWith('Dr.') || doctorName.startsWith('Dr ') ? doctorName : `Dr. ${doctorName}`;
  const subject = `Doctor Appointment Reminder: ${elderName} with ${docTitle}`;
  const plainText = [
    `Hello,`,
    ``,
    `Reminder: ${elderName} has an upcoming doctor appointment:`,
    `Doctor: ${docTitle}`,
    `Purpose: ${purpose || 'Medical Checkup'}`,
    `Date & Time: ${appointmentTime}`,
    `Place: ${place || 'Clinic / Hospital'}`,
    ``,
    `Please remember to bring any relevant medical records and current medication packaging.`,
    ``,
    `- CareCircle 360`
  ].join('\n');

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: auto; padding: 24px; border: 1px solid #dadce0; border-radius: 8px;">
      <h2 style="color: #00639b; margin-top: 0;">📅 Doctor Appointment Reminder</h2>
      <p style="font-size: 16px; color: #1f1f1f;">Reminder for an upcoming visit for <strong>${elderName}</strong>:</p>
      <div style="background-color: #e1f5fe; padding: 16px; border-radius: 6px; margin: 16px 0;">
        <p style="margin: 4px 0; font-size: 16px;"><strong>Doctor:</strong> ${docTitle}</p>
        <p style="margin: 4px 0; font-size: 15px;"><strong>Purpose:</strong> ${purpose || 'Consultation'}</p>
        <p style="margin: 4px 0; font-size: 15px;"><strong>Date & Time:</strong> ${appointmentTime}</p>
        <p style="margin: 4px 0; font-size: 15px;"><strong>Place:</strong> ${place || 'Clinic / Hospital'}</p>
      </div>
      <p style="font-size: 14px; color: #5f6368;">Remember to bring current prescription and packaging if needed.</p>
    </div>
  `;

  return sendEmail({ to, subject, text: plainText, html });
}

/**
 * Sends a Daily Care Pulse summary notification email.
 *
 * @param {Object} params
 * @param {string} params.to - Recipient email.
 * @param {string} params.elderName - Name of the elder.
 * @param {string} params.date - Date of report (YYYY-MM-DD).
 * @param {number} params.adherencePercentage - Calculated adherence percentage.
 * @param {number} params.dosesTaken - Number of doses confirmed taken.
 * @param {number} params.dosesMissed - Number of doses marked missed.
 * @param {number} params.totalDoses - Total scheduled doses.
 * @returns {Promise<Object>} Dispatch result.
 */
export async function sendDailyPulseSummary({
  to,
  elderName,
  date,
  adherencePercentage,
  dosesTaken,
  dosesMissed,
  totalDoses
}) {
  const subject = `Daily Care Pulse: ${elderName} (${date}) - ${adherencePercentage}% Adherence`;
  const plainText = `Daily Care Pulse for ${elderName} on ${date}: ${adherencePercentage}% adherence (${dosesTaken} of ${totalDoses} doses taken, ${dosesMissed} missed).`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: auto; padding: 20px; border: 1px solid #dadce0; border-radius: 8px;">
      <h2 style="color: #0b57d0; margin-top: 0;">Daily Care Pulse</h2>
      <p>Report for <strong>${elderName}</strong> on <strong>${date}</strong>:</p>
      <p><strong>Adherence:</strong> ${adherencePercentage}%</p>
      <p><strong>Doses Taken:</strong> ${dosesTaken} / ${totalDoses}</p>
      <p><strong>Missed:</strong> ${dosesMissed}</p>
    </div>
  `;
  return sendEmail({ to, subject, text: plainText, html });
}

/**
 * Sends the weekly family care digest email.
 *
 * @param {Object} params
 * @param {string} params.to - Recipient email.
 * @param {string} params.elderName - Name of the elder.
 * @param {string} params.weekRange - Date range of the digest.
 * @param {number} params.adherenceRate - Adherence percentage.
 * @param {string} params.summaryText - Plain language summary text.
 * @returns {Promise<Object>} Dispatch result.
 */
export async function sendWeeklyFamilySummary({
  to,
  elderName,
  weekRange,
  adherenceRate,
  summaryText
}) {
  const subject = `Weekly Care Circle Digest: ${elderName} (${weekRange})`;
  const plainText = `Weekly Care Summary for ${elderName} (${weekRange}): ${adherenceRate}% adherence.\n${summaryText}`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: auto; padding: 20px; border: 1px solid #dadce0; border-radius: 8px;">
      <h2 style="color: #0b57d0;">Weekly Family Care Summary</h2>
      <p>Report for <strong>${elderName}</strong> (${weekRange}):</p>
      <p><strong>Weekly Adherence:</strong> ${adherenceRate}%</p>
      <p>${summaryText}</p>
    </div>
  `;
  return sendEmail({ to, subject, text: plainText, html });
}
