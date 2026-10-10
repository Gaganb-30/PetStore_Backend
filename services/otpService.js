/**
 * otpService.js
 *
 * Email-based OTP service.
 * Generates 6-digit codes, stores them in a module-level Map with a TTL,
 * and delivers them via the existing SMTP/emailService transporter.
 *
 * In development (SMTP not configured), OTPs are printed to the console
 * instead of being emailed, so you can test without SMTP credentials.
 */

import crypto from 'crypto';
import config from '../config/index.js';
import { sendOtpEmail } from './emailService.js';

// ---------------------------------------------------------------------------
// In-memory OTP store: email → { otp, expiresAt, timer, attempts }
// Each entry auto-deletes after the configured expiry (OTP_EXPIRY_MINUTES).
// ---------------------------------------------------------------------------
const otpStore = new Map();

/**
 * Send a 6-digit OTP to an email address using cryptographically secure random numbers.
 *
 * @param {string} email  The recipient's email address
 * @returns {Promise<void>}
 */
export const sendOtp = async (email) => {
  const normalizedEmail = email.toLowerCase().trim();
  // Cryptographically secure 6-digit integer in range [100000, 999999]
  const otp = crypto.randomInt(100000, 1000000).toString();
  const expiryMs = (config.otpExpiryMinutes || 5) * 60 * 1000;

  // Clear any previously stored OTP for this email
  const existing = otpStore.get(normalizedEmail);
  if (existing?.timer) clearTimeout(existing.timer);

  // Store the OTP with an auto-cleanup timer
  const timer = setTimeout(() => {
    otpStore.delete(normalizedEmail);
  }, expiryMs);

  otpStore.set(normalizedEmail, {
    otp,
    expiresAt: Date.now() + expiryMs,
    timer,
    attempts: 0,
  });

  // ── Development fallback ──────────────────────────────────────────────
  if (!config.email.user || !config.email.pass) {
    console.warn(`[OTP DEV] Email: ${normalizedEmail}  OTP: ${otp}`);
    return;
  }

  // ── Production — send via SMTP ────────────────────────────────────────
  await sendOtpEmail(normalizedEmail, otp);
};

/**
 * Verify an OTP submitted by the user using timing-safe comparison and max attempt limits.
 *
 * @param {string} email  The email address
 * @param {string} otp    6-digit code entered by the user
 * @returns {Promise<boolean>} true if valid, false if not
 */
export const verifyOtp = async (email, otp) => {
  const normalizedEmail = email.toLowerCase().trim();
  const stored = otpStore.get(normalizedEmail);

  if (!stored) return false;

  // Check expiry
  if (Date.now() > stored.expiresAt) {
    if (stored.timer) clearTimeout(stored.timer);
    otpStore.delete(normalizedEmail);
    return false;
  }

  // Limit failed attempts to 5 per OTP to prevent brute-forcing
  stored.attempts = (stored.attempts || 0) + 1;
  if (stored.attempts > 5) {
    if (stored.timer) clearTimeout(stored.timer);
    otpStore.delete(normalizedEmail);
    return false;
  }

  // Check OTP match using timing-safe buffer comparison
  const storedBuf = Buffer.from(String(stored.otp), 'utf8');
  const inputBuf = Buffer.from(String(otp || ''), 'utf8');
  const isMatch = storedBuf.length === inputBuf.length && crypto.timingSafeEqual(storedBuf, inputBuf);

  if (!isMatch) return false;

  // Valid — clean up
  if (stored.timer) clearTimeout(stored.timer);
  otpStore.delete(normalizedEmail);
  return true;
};
