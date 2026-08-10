import crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import User from '../models/User.js';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../utils/generateToken.js';
import { asyncHandler } from '../utils/helpers.js';
import { ApiError } from '../middleware/errorHandler.js';
import { sendPasswordResetEmail, sendWelcomeEmail } from '../services/emailService.js';
import config from '../config/index.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Google ID-token verifier (created lazily so the app boots without a client ID) */
let googleClient;
const getGoogleClient = () => {
  if (!config.google.clientId) return null;
  if (!googleClient) googleClient = new OAuth2Client(config.google.clientId);
  return googleClient;
};

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
 * Every login path (local, Google, register) funnels through here so the
 * session contract stays identical no matter how the user signed in.
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

/**
 * @desc    Register new user
 * @route   POST /api/auth/register
 * @access  Public
 */
export const register = asyncHandler(async (req, res) => {
  const { firstName, lastName, email, password, phone } = req.body;

  // Check if user already exists
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    throw new ApiError(400, 'An account with this email already exists.');
  }

  // Create user
  const user = await User.create({
    firstName, lastName, email, password, phone, authProvider: 'local',
  });

  // Send welcome email (non-blocking — a mail outage must not fail signup)
  sendWelcomeEmail(user);

  await sendAuthResponse(res, user, { status: 201, message: 'Account created successfully.' });
});

/**
 * @desc    Sign in (or sign up) with Google
 * @route   POST /api/auth/google
 * @access  Public
 *
 * The client sends the Google ID token ("credential") it received from Google
 * Identity Services. We verify it server-side against Google's public keys —
 * the client is never trusted to assert who it is.
 */
export const googleAuth = asyncHandler(async (req, res) => {
  const { credential } = req.body;

  const client = getGoogleClient();
  if (!client) {
    throw new ApiError(503, 'Google sign-in is not configured on this server.');
  }
  if (!credential) {
    throw new ApiError(400, 'Missing Google credential.');
  }

  let payload;
  try {
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: config.google.clientId,
    });
    payload = ticket.getPayload();
  } catch {
    throw new ApiError(401, 'Google sign-in failed. Please try again.');
  }

  if (!payload?.email) {
    throw new ApiError(401, 'Google account did not return an email address.');
  }

  const email = payload.email.toLowerCase();

  // Existing account by Google ID, or by email (links a pre-existing local account)
  let user = await User.findOne({ $or: [{ googleId: payload.sub }, { email }] });

  if (user) {
    // Link the Google identity to the existing account on first Google login
    if (!user.googleId) {
      user.googleId = payload.sub;
      if (!user.avatar && payload.picture) user.avatar = payload.picture;
    }
    if (payload.email_verified) user.isEmailVerified = true;
    if (!user.isActive) {
      throw new ApiError(403, 'Account is deactivated. Contact support.');
    }
  } else {
    const [firstName, ...rest] = (payload.name || email.split('@')[0]).split(' ');
    user = new User({
      firstName: firstName || 'Pet',
      lastName: rest.join(' ') || 'Parent',
      email,
      googleId: payload.sub,
      authProvider: 'google',
      avatar: payload.picture || '',
      isEmailVerified: Boolean(payload.email_verified),
    });
    await user.save();
    sendWelcomeEmail(user);
  }

  await sendAuthResponse(res, user, { message: 'Signed in with Google.' });
});

/**
 * @desc    Login user
 * @route   POST /api/auth/login
 * @access  Public
 */
export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  // Find user with password
  const user = await User.findOne({ email }).select('+password');
  if (!user) {
    throw new ApiError(401, 'Invalid email or password.');
  }

  if (!user.isActive) {
    throw new ApiError(403, 'Your account has been deactivated. Contact support.');
  }

  // Google-only accounts have no password hash — point them at the right button
  if (!user.password && user.authProvider === 'google') {
    throw new ApiError(400, 'This account uses Google sign-in. Please continue with Google.');
  }

  // Check password
  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    throw new ApiError(401, 'Invalid email or password.');
  }

  await sendAuthResponse(res, user, { message: 'Login successful.' });
});

/**
 * @desc    Logout user
 * @route   POST /api/auth/logout
 * @access  Private
 */
export const logout = asyncHandler(async (req, res) => {
  const refreshToken = req.cookies.refreshToken;

  if (refreshToken) {
    // Remove refresh token from user
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

  // Verify refresh token
  let decoded;
  try {
    decoded = verifyRefreshToken(refreshToken);
  } catch {
    res.clearCookie('refreshToken');
    throw new ApiError(401, 'Invalid refresh token. Please login again.');
  }

  // Find user and check if this refresh token exists
  const user = await User.findById(decoded.id);
  if (!user) {
    throw new ApiError(401, 'User not found.');
  }

  const tokenExists = user.refreshTokens.some((t) => t.token === refreshToken);
  if (!tokenExists) {
    // Token reuse detected — clear all refresh tokens (security measure)
    user.refreshTokens = [];
    await user.save({ validateBeforeSave: false });
    res.clearCookie('refreshToken');
    throw new ApiError(401, 'Token reuse detected. Please login again.');
  }

  // Generate new tokens (token rotation)
  const newAccessToken = generateAccessToken(user._id);
  const newRefreshToken = generateRefreshToken(user._id);

  // Replace old refresh token with new one
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
 * @desc    Forgot password — send reset email
 * @route   POST /api/auth/forgot-password
 * @access  Public
 */
export const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;

  const user = await User.findOne({ email });
  if (!user) {
    // Don't reveal if user exists
    return res.json({ success: true, message: 'If the email exists, a reset link has been sent.' });
  }

  // Generate reset token
  const resetToken = crypto.randomBytes(32).toString('hex');
  user.passwordResetToken = crypto.createHash('sha256').update(resetToken).digest('hex');
  user.passwordResetExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
  await user.save({ validateBeforeSave: false });

  // Send email
  const resetUrl = `${config.clientUrl}/reset-password/${resetToken}`;
  await sendPasswordResetEmail(user, resetUrl);

  res.json({ success: true, message: 'If the email exists, a reset link has been sent.' });
});

/**
 * @desc    Reset password
 * @route   POST /api/auth/reset-password/:token
 * @access  Public
 */
export const resetPassword = asyncHandler(async (req, res) => {
  const { password } = req.body;
  const hashedToken = crypto.createHash('sha256').update(req.params.token).digest('hex');

  const user = await User.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpires: { $gt: Date.now() },
  });

  if (!user) {
    throw new ApiError(400, 'Invalid or expired reset token.');
  }

  user.password = password;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;
  user.refreshTokens = []; // Invalidate all sessions
  await user.save();

  res.json({ success: true, message: 'Password reset successful. Please login with your new password.' });
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
