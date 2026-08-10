import Settings from '../models/Settings.js';
import { asyncHandler } from '../utils/helpers.js';
import config from '../config/index.js';

/**
 * @desc    Public site settings
 * @route   GET /api/settings
 * @access  Public
 *
 * Also returns the *public* integration keys the storefront needs (the
 * Razorpay key id and Google OAuth client id are designed to be public — the
 * corresponding secrets never leave the server).
 */
export const getSettings = asyncHandler(async (req, res) => {
  const settings = await Settings.getSettings();
  res.json({
    success: true,
    data: {
      settings,
      integrations: {
        razorpayKeyId: config.razorpay.keyId || null,
        razorpayEnabled: Boolean(config.razorpay.keyId && config.razorpay.keySecret),
        googleClientId: config.google.clientId || null,
      },
    },
  });
});

/**
 * @desc    Update site settings
 * @route   PUT /api/settings
 * @access  Private/Admin
 */
export const updateSettings = asyncHandler(async (req, res) => {
  const settings = await Settings.getSettings();

  // `_id` / timestamps must never be overwritten from the request body
  const { _id, createdAt, updatedAt, __v, ...updates } = req.body;
  Object.assign(settings, updates);
  await settings.save();

  res.json({ success: true, message: 'Settings updated.', data: { settings } });
});
