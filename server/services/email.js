/**
 * Email service — sends OTP emails via SMTP (nodemailer).
 *
 * Fallback: if SMTP env vars are missing, logs OTP to console
 * (useful for local dev and testing).
 */
const nodemailer = require('nodemailer');

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER || 'noreply@claimanalytics.local';

const smtpConfigured = !!(SMTP_HOST && SMTP_USER && SMTP_PASS);

let transporter = null;

if (smtpConfigured) {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  console.log(`[EMAIL] SMTP configured: ${SMTP_HOST}:${SMTP_PORT}`);
} else {
  console.log('[EMAIL] SMTP not configured — OTPs will be logged to console');
}

/**
 * Send a 6-digit OTP email.
 * @param {string} to - recipient email
 * @param {string} otp - 6-digit plaintext OTP
 * @returns {Promise<boolean>} true if sent (or logged), false on error
 */
async function sendOtpEmail(to, otp) {
  if (!transporter) {
    // Dev fallback: log to console
    console.log(`[EMAIL] OTP for ${to}: ${otp}`);
    return true;
  }

  try {
    await transporter.sendMail({
      from: `"Claim Analytics" <${SMTP_FROM}>`,
      to,
      subject: 'Your verification code',
      text: `Your verification code is: ${otp}\n\nThis code expires in 10 minutes.\n\nIf you did not request this, please ignore this email.`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #0d9488; margin-bottom: 8px;">Claim Analytics</h2>
          <p style="color: #334155; font-size: 15px;">Your verification code is:</p>
          <div style="background: #f1f5f9; border-radius: 8px; padding: 20px; text-align: center; margin: 16px 0;">
            <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #0f172a;">${otp}</span>
          </div>
          <p style="color: #64748b; font-size: 13px;">This code expires in 10 minutes.</p>
          <p style="color: #94a3b8; font-size: 12px; margin-top: 24px;">If you did not request this, please ignore this email.</p>
        </div>
      `,
    });
    return true;
  } catch (err) {
    console.error('[EMAIL] Send failed:', err.message);
    return false;
  }
}

/**
 * Allow tests to override the transporter.
 */
function _setTransporter(t) {
  transporter = t;
}

module.exports = { sendOtpEmail, _setTransporter };
