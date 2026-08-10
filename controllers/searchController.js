import Product from '../models/Product.js';
import Category from '../models/Category.js';
import Brand from '../models/Brand.js';
import { asyncHandler, escapeRegex } from '../utils/helpers.js';

/**
 * @desc    Instant search — products, category/brand shortcuts and suggestions
 * @route   GET /api/search?q=...
 * @access  Public
 *
 * Powers the header dropdown, so it has to be fast and return everything the
 * dropdown renders in one round trip.
 */
export const search = asyncHandler(async (req, res) => {
  const q = (req.query.q || '').trim();
  const limit = Math.min(20, parseInt(req.query.limit, 10) || 8);

  if (q.length < 2) {
    return res.json({ success: true, data: { products: [], suggestions: [], categories: [], brands: [] } });
  }

  const rx = new RegExp(escapeRegex(q), 'i');
  // Anchored variant ranks "cat food" above "premium cat food" for the query "cat"
  const startsWith = new RegExp(`^${escapeRegex(q)}`, 'i');

  const [products, categories, brands, nameMatches] = await Promise.all([
    Product.find({
      isActive: true,
      $or: [{ name: rx }, { tags: rx }, { shortDescription: rx }, { sku: rx }],
    })
      .populate('brand', 'name slug')
      .populate('category', 'name slug')
      .select('name slug thumbnail price mrp discount ratingsAverage ratingsCount stock availability category brand')
      .sort({ ratingsCount: -1, ratingsAverage: -1 })
      .limit(limit)
      .lean(),

    Category.find({ isActive: true, name: rx }).select('name slug image').limit(4).lean(),
    Brand.find({ isActive: true, name: rx }).select('name slug logo').limit(4).lean(),

    Product.find({ isActive: true, $or: [{ name: startsWith }, { name: rx }] })
      .select('name')
      .limit(6)
      .lean(),
  ]);

  res.json({
    success: true,
    data: {
      query: q,
      products,
      categories,
      brands,
      suggestions: [...new Set(nameMatches.map((p) => p.name))].slice(0, 6),
      total: products.length,
    },
  });
});

/**
 * @desc    Popular search terms, derived from the catalogue's own tags
 * @route   GET /api/search/popular
 * @access  Public
 */
export const getPopularSearches = asyncHandler(async (req, res) => {
  const [tags, categories] = await Promise.all([
    Product.aggregate([
      { $match: { isActive: true } },
      { $unwind: '$tags' },
      { $group: { _id: '$tags', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 8 },
    ]),
    Category.find({ isActive: true, parent: null })
      .select('name slug')
      .sort({ sortOrder: 1 })
      .limit(6)
      .lean(),
  ]);

  res.json({
    success: true,
    data: {
      popularSearches: tags.map((t) => t._id),
      topCategories: categories,
    },
  });
});
