import Brand from '../models/Brand.js';
import { asyncHandler } from '../utils/helpers.js';
import { ApiError } from '../middleware/errorHandler.js';
import { invalidateSitemap } from '../services/sitemapService.js';
import { createUniqueSlug } from '../utils/slugify.js';

/**
 * @desc    Get all active brands
 * @route   GET /api/brands
 * @access  Public
 */
export const getBrands = asyncHandler(async (req, res) => {
  const brands = await Brand.find({ isActive: true })
    .populate('productCount')
    .sort({ name: 1 })
    .lean();

  res.json({ success: true, data: { brands } });
});

/**
 * @desc    Get brand by slug
 * @route   GET /api/brands/:slug
 * @access  Public
 */
export const getBrandBySlug = asyncHandler(async (req, res) => {
  const brand = await Brand.findOne({ slug: req.params.slug, isActive: true })
    .populate('productCount');

  if (!brand) throw new ApiError(404, 'Brand not found.');
  res.json({ success: true, data: { brand } });
});

/**
 * @desc    Get all brands (Admin)
 * @route   GET /api/brands/admin/all
 * @access  Private/Admin
 */
export const getAdminBrands = asyncHandler(async (req, res) => {
  const brands = await Brand.find().populate('productCount').sort({ createdAt: -1 }).lean();
  res.json({ success: true, data: { brands } });
});

/**
 * @desc    Create brand
 * @route   POST /api/brands
 * @access  Private/Admin
 */
export const createBrand = asyncHandler(async (req, res) => {
  req.body.slug = await createUniqueSlug(Brand, req.body.name);
  const brand = await Brand.create(req.body);
  invalidateSitemap();
  res.status(201).json({ success: true, message: 'Brand created.', data: { brand } });
});

/**
 * @desc    Update brand
 * @route   PUT /api/brands/:id
 * @access  Private/Admin
 */
export const updateBrand = asyncHandler(async (req, res) => {
  let brand = await Brand.findById(req.params.id);
  if (!brand) throw new ApiError(404, 'Brand not found.');

  if (req.body.name && req.body.name !== brand.name) {
    req.body.slug = await createUniqueSlug(Brand, req.body.name, brand._id);
  }

  brand = await Brand.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  invalidateSitemap();
  res.json({ success: true, message: 'Brand updated.', data: { brand } });
});

/**
 * @desc    Delete brand
 * @route   DELETE /api/brands/:id
 * @access  Private/Admin
 */
export const deleteBrand = asyncHandler(async (req, res) => {
  const brand = await Brand.findByIdAndDelete(req.params.id);
  if (!brand) throw new ApiError(404, 'Brand not found.');
  invalidateSitemap();
  res.json({ success: true, message: 'Brand deleted.' });
});
