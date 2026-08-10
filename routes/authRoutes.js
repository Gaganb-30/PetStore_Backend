import { Router } from 'express';
import { body } from 'express-validator';
import validate from '../middleware/validate.js';
import { protect } from '../middleware/auth.js';
import {
  register, login, googleAuth, logout, refreshAccessToken,
  forgotPassword, resetPassword, getMe,
} from '../controllers/authController.js';

const router = Router();

// Register
router.post('/register', [
  body('firstName').trim().notEmpty().withMessage('First name is required'),
  body('lastName').trim().notEmpty().withMessage('Last name is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
], validate, register);

// Login
router.post('/login', [
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required'),
], validate, login);

// Google OAuth — verifies the ID token issued by Google Identity Services
router.post('/google', [
  body('credential').notEmpty().withMessage('Google credential is required'),
], validate, googleAuth);

// Logout
router.post('/logout', protect, logout);

// Refresh token
router.post('/refresh-token', refreshAccessToken);

// Forgot password
router.post('/forgot-password', [
  body('email').isEmail().withMessage('Valid email is required'),
], validate, forgotPassword);

// Reset password
router.post('/reset-password/:token', [
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
], validate, resetPassword);

// Get current user
router.get('/me', protect, getMe);

export default router;
