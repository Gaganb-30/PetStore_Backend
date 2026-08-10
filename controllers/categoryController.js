import Category from '../models/Category.js';
import { asyncHandler } from '../utils/helpers.js';
import { ApiError } from '../middleware/errorHandler.js';
import { invalidateSitemap } from '../services/sitemapService.js';
import { createUniqueSlug } from '../utils/slugify.js';

/**
 * @desc    Get all categories (with subcategories)
 * @route   GET /api/categories
 * @access  Public
 */
export const getCategories = asyncHandler(async (req, res) => {
  const categories = await Category.find({ parent: null, isActive: true })
    .populate({
      path: 'subcategories',
      match: { isActive: true },
      select: 'name slug image',
      options: { sort: { sortOrder: 1 } },
    })
    .populate('productCount')
    .sort({ sortOrder: 1 })
    .lean();

  res.json({ success: true, data: { categories } });
});

/**
 * @desc    Get category by slug
 * @route   GET /api/categories/:slug
 * @access  Public
 */
export const getCategoryBySlug = asyncHandler(async (req, res) => {
  const category = await Category.findOne({ slug: req.params.slug, isActive: true })
    .populate({
      path: 'subcategories',
      match: { isActive: true },
      select: 'name slug image',
    })
    .populate('productCount');

  if (!category) {
    throw new ApiError(404, 'Category not found.');
  }

  res.json({ success: true, data: { category } });
});

/**
 * @desc    Get all categories (Admin — includes inactive)
 * @route   GET /api/categories/admin/all
 * @access  Private/Admin
 */
export const getAdminCategories = asyncHandler(async (req, res) => {
  const categories = await Category.find()
    .populate('parent', 'name slug')
    .populate('productCount')
    .sort({ sortOrder: 1, createdAt: -1 })
    .lean();

  res.json({ success: true, data: { categories } });
});

/**
 * @desc    Create category
 * @route   POST /api/categories
 * @access  Private/Admin
 */
export const createCategory = asyncHandler(async (req, res) => {
  req.body.slug = await createUniqueSlug(Category, req.body.name);

  const category = await Category.create(req.body);

  invalidateSitemap();
  res.status(201).json({
    success: true,
    message: 'Category created.',
    data: { category },
  });
});

/**
 * @desc    Update category
 * @route   PUT /api/categories/:id
 * @access  Private/Admin
 */
export const updateCategory = asyncHandler(async (req, res) => {
  let category = await Category.findById(req.params.id);
  if (!category) {
    throw new ApiError(404, 'Category not found.');
  }

  if (req.body.name && req.body.name !== category.name) {
    req.body.slug = await createUniqueSlug(Category, req.body.name, category._id);
  }

  category = await Category.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });

  invalidateSitemap();
  res.json({ success: true, message: 'Category updated.', data: { category } });
});

/**
 * @desc    Delete category
 * @route   DELETE /api/categories/:id
 * @access  Private/Admin
 */
export const deleteCategory = asyncHandler(async (req, res) => {
  const category = await Category.findById(req.params.id);
  if (!category) {
    throw new ApiError(404, 'Category not found.');
  }

  // Check for subcategories
  const subcategoryCount = await Category.countDocuments({ parent: req.params.id });
  if (subcategoryCount > 0) {
    throw new ApiError(400, 'Cannot delete a category with subcategories. Delete subcategories first.');
  }

  await Category.findByIdAndDelete(req.params.id);

  invalidateSitemap();
  res.json({ success: true, message: 'Category deleted.' });
});
