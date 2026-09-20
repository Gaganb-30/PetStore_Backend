/**
 * otpService.js
 *
 * Thin wrapper around MSG91's OTP REST API.
 * Docs: https://docs.msg91.com/reference/send-otp
 *
 * In development (MSG91_AUTH_KEY not set), OTPs are printed to the console
 * instead of being sent, so you can test without spending credits.
 */

import config from '../config/index.js';

const MSG91_BASE = 'https://api.msg91.com/api/v5';

/**
 * Send a 6-digit OTP to an Indian mobile number via MSG91.
 *
 * @param {string} phone  10-digit Indian mobile number (no +91 prefix)
 * @returns {Promise<void>}
 */
export const sendOtp = async (phone) => {
  // ── Development fallback ──────────────────────────────────────────────
  if (!config.msg91.authKey) {
    const devOtp = Math.floor(100000 + Math.random() * 900000).toString();
    console.warn(`[OTP DEV] Phone: +91${phone}  OTP: ${devOtp}`);
    // Store the dev OTP in a module-level map so verifyOtp can check it
    devOtpStore.set(phone, devOtp);
    return;
  }

  // ── Production — MSG91 Send OTP ───────────────────────────────────────
  const params = new URLSearchParams({
    template_id: config.msg91.templateId,
    mobile:      `91${phone}`,       // MSG91 expects country code + number
    authkey:     config.msg91.authKey,
    otp_length:  '6',
    otp_expiry:  '10',               // OTP valid for 10 minutes on MSG91's side
  });

  const url = `${MSG91_BASE}/otp?${params.toString()}`;
  const res = await fetch(url, { method: 'POST' });
  const body = await res.json().catch(() => ({}));

  if (!res.ok || body.type === 'error') {
    throw new Error(body.message || 'MSG91 send-OTP request failed.');
  }
};

/**
 * Verify an OTP submitted by the user against MSG91.
 *
 * @param {string} phone  10-digit Indian mobile number
 * @param {string} otp    6-digit code entered by the user
 * @returns {Promise<boolean>} true if valid, false if not
 */
export const verifyOtp = async (phone, otp) => {
  // ── Development fallback ──────────────────────────────────────────────
  if (!config.msg91.authKey) {
    const stored = devOtpStore.get(phone);
    if (stored && stored === otp) {
      devOtpStore.delete(phone);
      return true;
    }
    return false;
  }

  // ── Production — MSG91 Verify OTP ────────────────────────────────────
  const params = new URLSearchParams({
    mobile:  `91${phone}`,
    authkey: config.msg91.authKey,
    otp,
  });

  const url = `${MSG91_BASE}/otp/verify?${params.toString()}`;
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));

  // MSG91 returns { type: 'success' } on a valid OTP
  return body.type === 'success';
};

// ---------------------------------------------------------------------------
// Dev-only in-memory store — never used in production (authKey is set)
// ---------------------------------------------------------------------------
const devOtpStore = new Map();
