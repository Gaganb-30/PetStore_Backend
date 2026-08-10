import Banner from '../models/Banner.js';
import { asyncHandler } from '../utils/helpers.js';
import { ApiError } from '../middleware/errorHandler.js';

// @desc Get active banners | GET /api/banners | Public
export const getBanners = asyncHandler(async (req, res) => {
  const now = new Date();
  const banners = await Banner.find({
    isActive: true,
    $or: [
      { startDate: { $lte: now }, endDate: { $gte: now } },
      { startDate: null, endDate: null },
      { startDate: { $lte: now }, endDate: null },
      { startDate: null, endDate: { $gte: now } },
    ],
  }).sort({ sortOrder: 1 }).lean();

  res.json({ success: true, data: { banners } });
});

// @desc Get all banners (Admin) | GET /api/banners/admin/all | Private/Admin
export const getAdminBanners = asyncHandler(async (req, res) => {
  const banners = await Banner.find().sort({ sortOrder: 1, createdAt: -1 }).lean();
  res.json({ success: true, data: { banners } });
});

// @desc Create banner | POST /api/banners | Private/Admin
export const createBanner = asyncHandler(async (req, res) => {
  const banner = await Banner.create(req.body);
  res.status(201).json({ success: true, message: 'Banner created.', data: { banner } });
});

// @desc Update banner | PUT /api/banners/:id | Private/Admin
export const updateBanner = asyncHandler(async (req, res) => {
  const banner = await Banner.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!banner) throw new ApiError(404, 'Banner not found.');
  res.json({ success: true, message: 'Banner updated.', data: { banner } });
});

// @desc Delete banner | DELETE /api/banners/:id | Private/Admin
export const deleteBanner = asyncHandler(async (req, res) => {
  const banner = await Banner.findByIdAndDelete(req.params.id);
  if (!banner) throw new ApiError(404, 'Banner not found.');
  res.json({ success: true, message: 'Banner deleted.' });
});
