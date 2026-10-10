import Coupon from '../models/Coupon.js';
import { asyncHandler } from '../utils/helpers.js';
import { ApiError } from '../middleware/errorHandler.js';

// @desc Get all coupons (Admin) | GET /api/coupons | Private/Admin
export const getCoupons = asyncHandler(async (req, res) => {
  const coupons = await Coupon.find().sort({ createdAt: -1 }).lean();
  res.json({ success: true, data: { coupons } });
});

// @desc Create coupon | POST /api/coupons | Private/Admin
export const createCoupon = asyncHandler(async (req, res) => {
  const coupon = await Coupon.create(req.body);
  res.status(201).json({ success: true, message: 'Coupon created.', data: { coupon } });
});

// @desc Update coupon | PUT /api/coupons/:id | Private/Admin
export const updateCoupon = asyncHandler(async (req, res) => {
  const coupon = await Coupon.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!coupon) throw new ApiError(404, 'Coupon not found.');
  res.json({ success: true, message: 'Coupon updated.', data: { coupon } });
});

// @desc Delete coupon | DELETE /api/coupons/:id | Private/Admin
export const deleteCoupon = asyncHandler(async (req, res) => {
  const coupon = await Coupon.findByIdAndDelete(req.params.id);
  if (!coupon) throw new ApiError(404, 'Coupon not found.');
  res.json({ success: true, message: 'Coupon deleted.' });
});

// @desc Validate coupon (public check) | POST /api/coupons/validate | Private
export const validateCoupon = asyncHandler(async (req, res) => {
  const { code, orderTotal } = req.body;
  if (!code || typeof code !== 'string') {
    throw new ApiError(400, 'Please provide a valid coupon code.');
  }

  const cleanCode = code.trim().toUpperCase();
  const coupon = await Coupon.findOne({ code: cleanCode });
  if (!coupon) throw new ApiError(404, 'Invalid coupon code.');

  const total = Number(orderTotal) || 0;
  const validation = coupon.isValid(total, req.user._id);
  if (!validation.valid) throw new ApiError(400, validation.message);

  const discount = coupon.calculateDiscount(total);
  res.json({ success: true, data: { valid: true, discount, type: coupon.type, value: coupon.value } });
});
