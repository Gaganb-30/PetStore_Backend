import User from '../models/User.js';
import { asyncHandler, buildColorOptions } from '../utils/helpers.js';
import { ApiError } from '../middleware/errorHandler.js';

/**
 * @desc    Get user profile
 * @route   GET /api/users/profile
 * @access  Private
 */
export const getProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('-refreshTokens');
  res.json({ success: true, data: { user } });
});

/**
 * @desc    Update user profile
 * @route   PUT /api/users/profile
 * @access  Private
 */
export const updateProfile = asyncHandler(async (req, res) => {
  const { firstName, lastName, phone, avatar } = req.body;

  const user = await User.findByIdAndUpdate(
    req.user._id,
    { firstName, lastName, phone, avatar },
    { new: true, runValidators: true }
  ).select('-refreshTokens');

  res.json({ success: true, message: 'Profile updated.', data: { user } });
});

/**
 * @desc    Change password
 * @route   PUT /api/users/change-password
 * @access  Private
 */
export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  const user = await User.findById(req.user._id).select('+password');
  const isMatch = await user.comparePassword(currentPassword);
  if (!isMatch) {
    throw new ApiError(400, 'Current password is incorrect.');
  }

  user.password = newPassword;
  user.refreshTokens = []; // Invalidate all sessions
  await user.save();

  res.json({ success: true, message: 'Password changed successfully. Please login again.' });
});

/**
 * @desc    Get user addresses
 * @route   GET /api/users/addresses
 * @access  Private
 */
export const getAddresses = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('addresses');
  res.json({ success: true, data: { addresses: user.addresses } });
});

/**
 * @desc    Add address
 * @route   POST /api/users/addresses
 * @access  Private
 */
export const addAddress = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);

  // If this is set as default, unset others
  if (req.body.isDefault) {
    user.addresses.forEach((addr) => { addr.isDefault = false; });
  }

  // If it's the first address, make it default
  if (user.addresses.length === 0) {
    req.body.isDefault = true;
  }

  user.addresses.push(req.body);
  await user.save();

  res.status(201).json({ success: true, message: 'Address added.', data: { addresses: user.addresses } });
});

/**
 * @desc    Update address
 * @route   PUT /api/users/addresses/:addressId
 * @access  Private
 */
export const updateAddress = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  const address = user.addresses.id(req.params.addressId);

  if (!address) {
    throw new ApiError(404, 'Address not found.');
  }

  // If setting as default, unset others
  if (req.body.isDefault) {
    user.addresses.forEach((addr) => { addr.isDefault = false; });
  }

  Object.assign(address, req.body);
  await user.save();

  res.json({ success: true, message: 'Address updated.', data: { addresses: user.addresses } });
});

/**
 * @desc    Delete address
 * @route   DELETE /api/users/addresses/:addressId
 * @access  Private
 */
export const deleteAddress = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  const address = user.addresses.id(req.params.addressId);

  if (!address) {
    throw new ApiError(404, 'Address not found.');
  }

  address.deleteOne();
  await user.save();

  res.json({ success: true, message: 'Address deleted.', data: { addresses: user.addresses } });
});

/**
 * @desc    Get wishlist
 * @route   GET /api/users/wishlist
 * @access  Private
 */
export const getWishlist = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).populate({
    path: 'wishlist',
    // Same field set the catalogue returns, so the wishlist page can reuse
    // ProductCard — including variants, which become colour swatches.
    select: 'name slug thumbnail images price mrp discount stock availability ratingsAverage ratingsCount isActive variants attributes brand',
    populate: { path: 'brand', select: 'name slug' },
  }).lean();

  const wishlist = (user?.wishlist || []).map((product) => {
    const { variants, ...rest } = product;
    return {
      ...rest,
      colorOptions: buildColorOptions(product),
      inStock: product.availability !== 'out_of_stock'
        && product.availability !== 'discontinued'
        && ((product.stock ?? 0) > 0 || (variants || []).some((v) => v.stock > 0)),
    };
  });

  res.json({ success: true, data: { wishlist } });
});

/**
 * @desc    Toggle product in wishlist
 * @route   POST /api/users/wishlist/:productId
 * @access  Private
 */
export const toggleWishlist = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  const productId = req.params.productId;

  const index = user.wishlist.indexOf(productId);
  if (index > -1) {
    user.wishlist.splice(index, 1);
    await user.save();
    res.json({ success: true, message: 'Removed from wishlist.', data: { inWishlist: false } });
  } else {
    user.wishlist.push(productId);
    await user.save();
    res.json({ success: true, message: 'Added to wishlist.', data: { inWishlist: true } });
  }
});

/**
 * @desc    Get all users (Admin)
 * @route   GET /api/users
 * @access  Private/Admin
 */
export const getAllUsers = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const skip = (page - 1) * limit;

  const filter = {};
  if (req.query.role) filter.role = req.query.role;
  if (req.query.search) {
    filter.$or = [
      { firstName: { $regex: req.query.search, $options: 'i' } },
      { lastName: { $regex: req.query.search, $options: 'i' } },
      { email: { $regex: req.query.search, $options: 'i' } },
    ];
  }

  const [users, total] = await Promise.all([
    User.find(filter).select('-refreshTokens -password').sort({ createdAt: -1 }).skip(skip).limit(limit),
    User.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: {
      users,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    },
  });
});

/**
 * @desc    Update user status (Admin)
 * @route   PATCH /api/users/:id/status
 * @access  Private/Admin
 */
export const updateUserStatus = asyncHandler(async (req, res) => {
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { isActive: req.body.isActive },
    { new: true }
  ).select('-refreshTokens -password');

  if (!user) throw new ApiError(404, 'User not found.');

  res.json({ success: true, message: `User ${req.body.isActive ? 'activated' : 'deactivated'}.`, data: { user } });
});
