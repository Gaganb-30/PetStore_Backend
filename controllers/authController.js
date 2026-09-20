import User from '../models/User.js';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../utils/generateToken.js';
import { asyncHandler } from '../utils/helpers.js';
import { ApiError } from '../middleware/errorHandler.js';
import { sendOtp as sendOtpViaMsg91, verifyOtp as verifyOtpViaMsg91 } from '../services/otpService.js';
import config from '../config/index.js';

// ---------------------------------------------------------------------------
// Commented-out providers (kept for easy re-enable later)
// ---------------------------------------------------------------------------
// import crypto from 'crypto';
// import { OAuth2Client } from 'google-auth-library';
// import { sendPasswordResetEmail, sendWelcomeEmail } from '../services/emailService.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

// /** Google ID-token verifier (created lazily so the app boots without a client ID) */
// let googleClient;
// const getGoogleClient = () => {
//   if (!config.google.clientId) return null;
//   if (!googleClient) googleClient = new OAuth2Client(config.google.clientId);
//   return googleClient;
// };

/** Cookie options for the refresh-token cookie */
const refreshCookieOptions = () => ({
  httpOnly: true,
  secure: config.env === 'production',
  sameSite: config.cookieSameSite,
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  path: '/',
});

/** Shape a user document for the client — never leaks password or tokens */
export const publicUser = (user) => ({
  _id: user._id,
  firstName: user.firstName,
  lastName: user.lastName,
  email: user.email,
  phone: user.phone,
  avatar: user.avatar,
  role: user.role,
  authProvider: user.authProvider,
  hasPassword: Boolean(user.password) || user.authProvider === 'local',
  createdAt: user.createdAt,
});

/**
 * Issue an access token, persist + set a rotating refresh token, and respond.
 * Every login path funnels through here so the session contract is identical.
 */
const sendAuthResponse = async (res, user, { status = 200, message } = {}) => {
  const accessToken = generateAccessToken(user._id);
  const refreshToken = generateRefreshToken(user._id);

  // Keep at most 5 active sessions per user
  user.refreshTokens.push({ token: refreshToken });
  if (user.refreshTokens.length > 5) {
    user.refreshTokens = user.refreshTokens.slice(-5);
  }
  user.lastLogin = new Date();
  await user.save({ validateBeforeSave: false });

  res.cookie('refreshToken', refreshToken, refreshCookieOptions());

  res.status(status).json({
    success: true,
    message,
    data: { user: publicUser(user), accessToken },
  });
};

// ---------------------------------------------------------------------------
// Phone + OTP auth (primary storefront flow)
// ---------------------------------------------------------------------------

// In-memory fallback for throttling repeat OTP sends for unregistered phone numbers
const recentOtpSends = new Map();

/**
 * @desc    Send OTP to a mobile number
 * @route   POST /api/auth/send-otp
 * @access  Public
 */
export const sendOtp = asyncHandler(async (req, res) => {
  const { phone } = req.body;

  // Basic Indian mobile number validation (10 digits, starts 6-9)
  if (!phone || !/^[6-9]\d{9}$/.test(phone)) {
    throw new ApiError(400, 'Please enter a valid 10-digit Indian mobile number.');
  }

  // Enforce resend timeout — check in-memory map and existing user's otpLastSentAt
  const existingUser = await User.findOne({ phone });
  const lastSent = existingUser?.otpLastSentAt?.getTime() || recentOtpSends.get(phone);
  if (lastSent) {
    const elapsedMinutes = (Date.now() - lastSent) / 1000 / 60;
    if (elapsedMinutes < config.otpTimeoutMinutes) {
      const waitSecs = Math.ceil((config.otpTimeoutMinutes - elapsedMinutes) * 60);
      throw new ApiError(
        429,
        `Please wait ${waitSecs} seconds before requesting a new OTP.`,
      );
    }
  }

  // Send OTP via MSG91
  await sendOtpViaMsg91(phone);

  // Record send timestamp in memory and in DB if user exists
  recentOtpSends.set(phone, Date.now());
  setTimeout(() => recentOtpSends.delete(phone), (config.otpTimeoutMinutes + 1) * 60 * 1000);

  await User.updateOne(
    { phone },
    { $set: { otpLastSentAt: new Date() } },
    { upsert: false },
  );

  res.json({
    success: true,
    message: 'OTP sent successfully.',
    data: { otpTimeoutMinutes: config.otpTimeoutMinutes },
  });
});

/**
 * @desc    Verify OTP and issue a session (creates account if phone is new)
 * @route   POST /api/auth/verify-otp
 * @access  Public
 */
export const verifyOtp = asyncHandler(async (req, res) => {
  const { phone, otp } = req.body;

  if (!phone || !/^[6-9]\d{9}$/.test(phone)) {
    throw new ApiError(400, 'Invalid phone number.');
  }
  if (!otp || !/^\d{6}$/.test(otp)) {
    throw new ApiError(400, 'OTP must be 6 digits.');
  }

  // Verify against MSG91 (or dev store)
  const isValid = await verifyOtpViaMsg91(phone, otp);
  if (!isValid) {
    throw new ApiError(401, 'Incorrect OTP. Please try again.');
  }

  // Find or create user
  let user = await User.findOne({ phone });
  let isNew = false;

  if (!user) {
    // New user — create account with a placeholder name so the document is valid.
    // firstName carries a timestamp suffix so every auto-created account is
    // distinguishable even if the user abandons checkout before entering a real name.
    const ts = Date.now();
    user = await User.create({
      firstName: `Guest${ts}`,
      lastName: '',
      phone,
      authProvider: 'phone',
      isPhoneVerified: true,
    });
    isNew = true;
  } else {
    if (!user.isActive) {
      throw new ApiError(403, 'Account is deactivated. Contact support.');
    }
    // Mark phone as verified on every successful OTP (idempotent)
    user.isPhoneVerified = true;
    // Reset the resend throttle timestamp after a successful verify
    user.otpLastSentAt = null;
    await user.save({ validateBeforeSave: false });
  }

  await sendAuthResponse(res, user, {
    status: isNew ? 201 : 200,
    message: isNew ? 'Account created. Welcome to AniLiving!' : 'Login successful.',
  });
});

// ---------------------------------------------------------------------------
// Admin-only email + password login (kept private, not exposed in public UI)
// ---------------------------------------------------------------------------

/**
 * @desc    Admin login with email + password
 * @route   POST /api/auth/admin-login
 * @access  Public (but only issues session for role === 'admin')
 */
export const adminLogin = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email }).select('+password');
  if (!user) {
    throw new ApiError(401, 'Invalid credentials.');
  }
  if (user.role !== 'admin') {
    throw new ApiError(403, 'Access denied.');
  }
  if (!user.isActive) {
    throw new ApiError(403, 'Account is deactivated. Contact support.');
  }
  if (!user.password) {
    throw new ApiError(400, 'This admin account has no password set.');
  }

  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    throw new ApiError(401, 'Invalid credentials.');
  }

  await sendAuthResponse(res, user, { message: 'Admin login successful.' });
});

// ---------------------------------------------------------------------------
// Google OAuth (commented out — re-enable when needed)
// ---------------------------------------------------------------------------

// /**
//  * @desc    Sign in (or sign up) with Google
//  * @route   POST /api/auth/google
//  * @access  Public
//  */
// export const googleAuth = asyncHandler(async (req, res) => {
//   const { credential } = req.body;
//   const client = getGoogleClient();
//   if (!client) throw new ApiError(503, 'Google sign-in is not configured on this server.');
//   if (!credential) throw new ApiError(400, 'Missing Google credential.');
//
//   let payload;
//   try {
//     const ticket = await client.verifyIdToken({
//       idToken: credential,
//       audience: config.google.clientId,
//     });
//     payload = ticket.getPayload();
//   } catch {
//     throw new ApiError(401, 'Google sign-in failed. Please try again.');
//   }
//
//   if (!payload?.email) throw new ApiError(401, 'Google account did not return an email address.');
//   const email = payload.email.toLowerCase();
//   let user = await User.findOne({ $or: [{ googleId: payload.sub }, { email }] });
//
//   if (user) {
//     if (!user.googleId) {
//       user.googleId = payload.sub;
//       if (!user.avatar && payload.picture) user.avatar = payload.picture;
//     }
//     if (payload.email_verified) user.isEmailVerified = true;
//     if (!user.isActive) throw new ApiError(403, 'Account is deactivated. Contact support.');
//   } else {
//     const [firstName, ...rest] = (payload.name || email.split('@')[0]).split(' ');
//     user = new User({
//       firstName: firstName || 'Pet',
//       lastName: rest.join(' ') || 'Parent',
//       email,
//       googleId: payload.sub,
//       authProvider: 'google',
//       avatar: payload.picture || '',
//       isEmailVerified: Boolean(payload.email_verified),
//     });
//     await user.save();
//     sendWelcomeEmail(user);
//   }
//
//   await sendAuthResponse(res, user, { message: 'Signed in with Google.' });
// });

// ---------------------------------------------------------------------------
// Session management (unchanged)
// ---------------------------------------------------------------------------

/**
 * @desc    Logout user
 * @route   POST /api/auth/logout
 * @access  Private
 */
export const logout = asyncHandler(async (req, res) => {
  const refreshToken = req.cookies.refreshToken;

  if (refreshToken) {
    await User.findByIdAndUpdate(req.user._id, {
      $pull: { refreshTokens: { token: refreshToken } },
    });
  }

  res.clearCookie('refreshToken', { path: '/' });
  res.json({ success: true, message: 'Logged out successfully.' });
});

/**
 * @desc    Refresh access token
 * @route   POST /api/auth/refresh-token
 * @access  Public (with refresh token cookie)
 */
export const refreshAccessToken = asyncHandler(async (req, res) => {
  const refreshToken = req.cookies.refreshToken;

  if (!refreshToken) {
    throw new ApiError(401, 'No refresh token. Please login again.');
  }

  let decoded;
  try {
    decoded = verifyRefreshToken(refreshToken);
  } catch {
    res.clearCookie('refreshToken');
    throw new ApiError(401, 'Invalid refresh token. Please login again.');
  }

  const user = await User.findById(decoded.id);
  if (!user) {
    throw new ApiError(401, 'User not found.');
  }

  const tokenExists = user.refreshTokens.some((t) => t.token === refreshToken);
  if (!tokenExists) {
    user.refreshTokens = [];
    await user.save({ validateBeforeSave: false });
    res.clearCookie('refreshToken');
    throw new ApiError(401, 'Token reuse detected. Please login again.');
  }

  const newAccessToken = generateAccessToken(user._id);
  const newRefreshToken = generateRefreshToken(user._id);

  user.refreshTokens = user.refreshTokens.filter((t) => t.token !== refreshToken);
  user.refreshTokens.push({ token: newRefreshToken });
  await user.save({ validateBeforeSave: false });

  res.cookie('refreshToken', newRefreshToken, refreshCookieOptions());

  res.json({
    success: true,
    data: { accessToken: newAccessToken },
  });
});

/**
 * @desc    Get current user
 * @route   GET /api/auth/me
 * @access  Private
 */
export const getMe = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: { user: publicUser(req.user) },
  });
});

// ---------------------------------------------------------------------------
// Legacy endpoints — commented out, not removed
// ---------------------------------------------------------------------------

// export const register = asyncHandler(async (req, res) => { ... });
// export const login = asyncHandler(async (req, res) => { ... });
// export const forgotPassword = asyncHandler(async (req, res) => { ... });
// export const resetPassword = asyncHandler(async (req, res) => { ... });
