import { Router } from 'express';
import { body } from 'express-validator';
import validate from '../middleware/validate.js';
import { protect } from '../middleware/auth.js';
import {
  sendOtp, verifyOtp, adminLogin,
  logout, refreshAccessToken, getMe,
} from '../controllers/authController.js';

// Commented-out imports (re-enable with their routes below when needed)
// import { googleAuth } from '../controllers/authController.js';

const router = Router();

// ---------------------------------------------------------------------------
// Phone + OTP (primary storefront auth)
// ---------------------------------------------------------------------------

// Step 1 — send OTP to phone number
router.post('/send-otp', [
  body('phone')
    .trim()
    .matches(/^[6-9]\d{9}$/)
    .withMessage('Enter a valid 10-digit Indian mobile number'),
], validate, sendOtp);

// Step 2 — verify OTP, create or retrieve account, issue session
router.post('/verify-otp', [
  body('phone')
    .trim()
    .matches(/^[6-9]\d{9}$/)
    .withMessage('Enter a valid 10-digit Indian mobile number'),
  body('otp')
    .trim()
    .matches(/^\d{6}$/)
    .withMessage('OTP must be exactly 6 digits'),
], validate, verifyOtp);

// ---------------------------------------------------------------------------
// Admin-only email + password login (not linked from the storefront UI)
// ---------------------------------------------------------------------------
router.post('/admin-login', [
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required'),
], validate, adminLogin);

// ---------------------------------------------------------------------------
// Google OAuth — commented out, re-enable when ready
// ---------------------------------------------------------------------------
// router.post('/google', [
//   body('credential').notEmpty().withMessage('Google credential is required'),
// ], validate, googleAuth);

// ---------------------------------------------------------------------------
// Session management (unchanged)
// ---------------------------------------------------------------------------

// Logout
router.post('/logout', protect, logout);

// Refresh token
router.post('/refresh-token', refreshAccessToken);

// Get current user
router.get('/me', protect, getMe);

// ---------------------------------------------------------------------------
// Legacy routes — commented out, not removed
// ---------------------------------------------------------------------------
// router.post('/register', [...], validate, register);
// router.post('/login', [...], validate, login);
// router.post('/forgot-password', [...], validate, forgotPassword);
// router.post('/reset-password/:token', [...], validate, resetPassword);

export default router;
