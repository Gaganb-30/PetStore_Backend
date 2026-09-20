import mongoose from 'mongoose';
import Product from '../models/Product.js';
import Category from '../models/Category.js';
import Brand from '../models/Brand.js';
import {
  asyncHandler, buildProductFilters, buildSortOptions, paginate,
  buildColorOptions, escapeRegex,
} from '../utils/helpers.js';
import { ApiError } from '../middleware/errorHandler.js';
import { createUniqueSlug } from '../utils/slugify.js';
import { invalidateSitemap } from '../services/sitemapService.js';
import { parseCsv, toCsv } from '../utils/csv.js';

// Fields a listing needs. Heavy prose and relations are excluded, but variants
// and attributes are kept because the card renders colour swatches from them.
const LIST_FIELDS = 'name slug thumbnail images price mrp discount stock availability ratingsAverage ratingsCount isBestSeller isNewArrival isTrending isFeatured isFlashDeal flashDealExpiry attributes variants shortDescription category brand createdAt';

/**
 * Turn a raw product document into the shape the storefront consumes.
 * Variants are collapsed into `colorOptions` so one product = one card, with
 * the swatches needed to swap the image in place.
 */
const decorate = (product) => {
  const colorOptions = buildColorOptions(product);
  const { variants, ...rest } = product;
  return {
    ...rest,
    colorOptions,
    variantCount: variants?.length || 0,
    // A product is buyable if base stock or any variant has units
    inStock: product.availability !== 'out_of_stock'
      && product.availability !== 'discontinued'
      && ((product.stock ?? 0) > 0 || (variants || []).some((v) => v.stock > 0)),
  };
};

/** Resolve a slug OR ObjectId to an ObjectId for category/brand query params */
const resolveRefs = async (query) => {
  const resolved = { ...query };

  const lookup = async (Model, value) => {
    const parts = String(value).split(',').map((v) => v.trim()).filter(Boolean);
    const ids = [];
    for (const part of parts) {
      if (mongoose.isValidObjectId(part)) ids.push(part);
      else {
        const doc = await Model.findOne({ slug: part }).select('_id').lean();
        if (doc) ids.push(doc._id.toString());
      }
    }
    return ids.join(',');
  };

  if (query.category) resolved.category = await lookup(Category, query.category);
  if (query.subcategory) resolved.subcategory = await lookup(Category, query.subcategory);
  if (query.brand) resolved.brand = await lookup(Brand, query.brand);

  // A slug that matched nothing must return zero results, not everything
  for (const key of ['category', 'subcategory', 'brand']) {
    if (query[key] && !resolved[key]) resolved[key] = new mongoose.Types.ObjectId().toString();
  }
  return resolved;
};

// ===========================================================================
// Public catalogue
// ===========================================================================

/**
 * @desc    List products with filters, sorting and pagination
 * @route   GET /api/products
 * @access  Public
 */
export const getProducts = asyncHandler(async (req, res) => {
  const query = await resolveRefs(req.query);
  const filters = buildProductFilters(query);
  const sort = buildSortOptions(query.sort);
  const { page, limit, skip } = paginate(query);

  const [products, total, facets] = await Promise.all([
    Product.find(filters)
      .populate('category', 'name slug')
      .populate('subcategory', 'name slug')
      .populate('brand', 'name slug logo')
      .select(LIST_FIELDS)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    Product.countDocuments(filters),
    buildFacets(query),
  ]);

  res.json({
    success: true,
    data: {
      products: products.map(decorate),
      filters: facets,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
    },
  });
});

/**
 * @desc    Available filter options for the current query
 * @route   GET /api/products/filters
 * @access  Public
 *
 * Exposed separately so the shop sidebar can refresh its facets without
 * re-fetching the product grid.
 */
export const getProductFilters = asyncHandler(async (req, res) => {
  const query = await resolveRefs(req.query);
  res.json({ success: true, data: { filters: await buildFacets(query) } });
});

/**
 * @desc    Single product by slug
 * @route   GET /api/products/:slug
 * @access  Public
 */
export const getProductBySlug = asyncHandler(async (req, res) => {
  const product = await Product.findOne({ slug: req.params.slug, isActive: true })
    .populate('category', 'name slug parent')
    .populate('subcategory', 'name slug')
    .populate('brand', 'name slug logo description')
    .populate('relatedProducts', 'name slug thumbnail price mrp discount ratingsAverage ratingsCount')
    .populate('frequentlyBoughtTogether', 'name slug thumbnail price mrp discount ratingsAverage')
    .lean();

  if (!product) throw new ApiError(404, 'Product not found.');

  // Fall back to same-category products when the admin hasn't picked any
  let related = product.relatedProducts || [];
  if (related.length === 0 && product.category?._id) {
    related = await Product.find({
      _id: { $ne: product._id },
      category: product.category._id,
      isActive: true,
    })
      .select('name slug thumbnail price mrp discount ratingsAverage ratingsCount')
      .sort({ ratingsCount: -1 })
      .limit(8)
      .lean();
  }

  res.json({
    success: true,
    data: {
      product: {
        ...product,
        colorOptions: buildColorOptions(product),
        relatedProducts: related,
      },
    },
  });
});

/** Shared implementation behind the "featured / new / best-seller / …" rails */
const listByFlag = (flag, extraFilter = {}) => asyncHandler(async (req, res) => {
  const limit = Math.min(24, parseInt(req.query.limit, 10) || 8);
  const products = await Product.find({ isActive: true, [flag]: true, ...extraFilter })
    .populate('brand', 'name slug logo')
    .populate('category', 'name slug')
    .select(LIST_FIELDS)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  res.json({ success: true, data: { products: products.map(decorate) } });
});

export const getFeaturedProducts = listByFlag('isFeatured');
export const getNewArrivals = listByFlag('isNewArrival');
export const getBestSellers = listByFlag('isBestSeller');
export const getTrendingProducts = listByFlag('isTrending');

/**
 * @desc    Flash deals — only those that haven't expired
 * @route   GET /api/products/flash-deals
 * @access  Public
 */
export const getFlashDeals = asyncHandler(async (req, res) => {
  const limit = Math.min(24, parseInt(req.query.limit, 10) || 8);
  const products = await Product.find({
    isActive: true,
    isFlashDeal: true,
    $or: [{ flashDealExpiry: { $exists: false } }, { flashDealExpiry: null }, { flashDealExpiry: { $gt: new Date() } }],
  })
    .populate('brand', 'name slug logo')
    .select(LIST_FIELDS)
    .sort({ flashDealExpiry: 1 })
    .limit(limit)
    .lean();

  res.json({ success: true, data: { products: products.map(decorate) } });
});

// ===========================================================================
// Admin — CRUD
// ===========================================================================

/** Normalise the admin form payload (Maps, numbers, cleanup) before saving */
const normalisePayload = (body) => {
  const data = { ...body };

  // Blank ObjectId strings must become undefined, not ''
  for (const ref of ['brand', 'category', 'subcategory']) {
    if (data[ref] === '' || data[ref] === null) delete data[ref];
  }

  // Specifications arrive as [{key, value}] from the dynamic form builder
  if (Array.isArray(data.specifications)) {
    data.specifications = data.specifications.reduce((acc, { key, value }) => {
      if (key?.trim()) acc[key.trim()] = value;
      return acc;
    }, {});
  }

  if (Array.isArray(data.features)) {
    data.features = data.features.map((f) => String(f).trim()).filter(Boolean);
  }
  if (Array.isArray(data.tags)) {
    data.tags = data.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean);
  }
  if (Array.isArray(data.images)) {
    data.images = data.images.map((i) => String(i).trim()).filter(Boolean);
  }
  if (Array.isArray(data.attributes)) {
    data.attributes = data.attributes
      .filter((a) => a?.name?.trim())
      .map((a) => ({
        name: a.name.trim(),
        values: (Array.isArray(a.values) ? a.values : String(a.values || '').split(','))
          .map((v) => String(v).trim()).filter(Boolean),
      }));
  }
  if (Array.isArray(data.variants)) {
    data.variants = data.variants
      .filter((v) => v && v.price !== '' && v.price !== null && v.price !== undefined)
      .map((v) => ({
        ...v,
        price: Number(v.price),
        mrp: v.mrp === '' || v.mrp === undefined ? undefined : Number(v.mrp),
        stock: Number(v.stock) || 0,
        images: (v.images || []).map((i) => String(i).trim()).filter(Boolean),
        // Trim whitespace from keys AND values to prevent "Color " ≠ "Color" mismatches
        attributeCombination: Object.fromEntries(
          Object.entries(v.attributeCombination || {}).map(([k, val]) => [k.trim(), String(val).trim()])
        ),
      }));
  }

  // Keep the derived discount honest
  if (data.mrp && data.price && Number(data.mrp) > Number(data.price)) {
    data.discount = Math.round(((data.mrp - data.price) / data.mrp) * 100);
  } else if (data.price !== undefined) {
    data.discount = 0;
  }

  return data;
};

/**
 * @desc    Create product
 * @route   POST /api/products
 * @access  Private/Admin
 */
export const createProduct = asyncHandler(async (req, res) => {
  const data = normalisePayload(req.body);
  data.slug = data.slug?.trim()
    ? await createUniqueSlug(Product, data.slug)
    : await createUniqueSlug(Product, data.name);

  const product = await Product.create(data);
  invalidateSitemap();

  res.status(201).json({ success: true, message: 'Product created successfully.', data: { product } });
});

/**
 * @desc    Update product
 * @route   PUT /api/products/:id
 * @access  Private/Admin
 */
export const updateProduct = asyncHandler(async (req, res) => {
  const existing = await Product.findById(req.params.id);
  if (!existing) throw new ApiError(404, 'Product not found.');

  const data = normalisePayload(req.body);

  // Only regenerate the slug when the admin didn't set one explicitly
  if (data.slug?.trim() && data.slug !== existing.slug) {
    data.slug = await createUniqueSlug(Product, data.slug, existing._id);
  } else if (!data.slug && data.name && data.name !== existing.name) {
    data.slug = await createUniqueSlug(Product, data.name, existing._id);
  } else {
    delete data.slug;
  }

  const product = await Product.findByIdAndUpdate(req.params.id, data, {
    new: true,
    runValidators: true,
  });
  invalidateSitemap();

  res.json({ success: true, message: 'Product updated.', data: { product } });
});

/**
 * @desc    Delete product
 * @route   DELETE /api/products/:id
 * @access  Private/Admin
 */
export const deleteProduct = asyncHandler(async (req, res) => {
  const product = await Product.findByIdAndDelete(req.params.id);
  if (!product) throw new ApiError(404, 'Product not found.');
  invalidateSitemap();
  res.json({ success: true, message: 'Product deleted.' });
});

/**
 * @desc    Bulk delete
 * @route   POST /api/products/bulk-delete
 * @access  Private/Admin
 */
export const bulkDeleteProducts = asyncHandler(async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) throw new ApiError(400, 'Please select at least one product.');

  const result = await Product.deleteMany({ _id: { $in: ids } });
  invalidateSitemap();
  res.json({ success: true, message: `${result.deletedCount} product(s) deleted.` });
});

/**
 * @desc    Bulk status / flag change
 * @route   POST /api/products/bulk-status
 * @access  Private/Admin
 */
export const bulkUpdateStatus = asyncHandler(async (req, res) => {
  const { ids, updates } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) throw new ApiError(400, 'Please select at least one product.');

  // Whitelist so a crafted request can't rewrite prices via this endpoint
  const allowed = ['isActive', 'isFeatured', 'isNewArrival', 'isBestSeller', 'isTrending', 'isFlashDeal', 'availability'];
  const safeUpdates = Object.fromEntries(
    Object.entries(updates || {}).filter(([k]) => allowed.includes(k)),
  );
  if (Object.keys(safeUpdates).length === 0) throw new ApiError(400, 'No valid fields to update.');

  await Product.updateMany({ _id: { $in: ids } }, safeUpdates);
  invalidateSitemap();
  res.json({ success: true, message: `${ids.length} product(s) updated.` });
});

/**
 * @desc    Duplicate a product as an unpublished draft
 * @route   POST /api/products/:id/duplicate
 * @access  Private/Admin
 */
export const duplicateProduct = asyncHandler(async (req, res) => {
  const original = await Product.findById(req.params.id).lean();
  if (!original) throw new ApiError(404, 'Product not found.');

  delete original._id;
  delete original.__v;
  delete original.createdAt;
  delete original.updatedAt;
  delete original.id;

  original.name = `${original.name} (Copy)`;
  original.slug = await createUniqueSlug(Product, original.name);
  original.sku = original.sku ? `${original.sku}-COPY` : undefined;
  original.isActive = false; // draft
  original.ratingsAverage = 0;
  original.ratingsCount = 0;

  const product = await Product.create(original);
  res.status(201).json({ success: true, message: 'Product duplicated as a draft.', data: { product } });
});

/**
 * @desc    Admin product list (includes drafts)
 * @route   GET /api/products/admin/all
 * @access  Private/Admin
 */
export const getAdminProducts = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req.query, { defaultLimit: 20, maxLimit: 100 });

  const filter = {};
  if (req.query.search) {
    const rx = new RegExp(escapeRegex(req.query.search.trim()), 'i');
    filter.$or = [{ name: rx }, { sku: rx }, { slug: rx }];
  }
  if (req.query.category) filter.category = req.query.category;
  if (req.query.brand) filter.brand = req.query.brand;
  if (req.query.isActive !== undefined && req.query.isActive !== '') filter.isActive = req.query.isActive === 'true';
  if (req.query.availability) filter.availability = req.query.availability;
  if (req.query.lowStock === 'true') filter.$expr = { $lte: ['$stock', '$lowStockAlert'] };

  const [products, total] = await Promise.all([
    Product.find(filter)
      .populate('category', 'name')
      .populate('brand', 'name')
      .select('name slug thumbnail price mrp discount stock lowStockAlert availability isActive isFeatured isNewArrival isBestSeller isTrending isFlashDeal sku variants createdAt')
      .sort(buildSortOptions(req.query.sort))
      .skip(skip)
      .limit(limit)
      .lean(),
    Product.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: {
      products: products.map((p) => ({
        ...p,
        variantCount: p.variants?.length || 0,
        variants: undefined,
      })),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
    },
  });
});

/**
 * @desc    Full product document for the admin edit form
 * @route   GET /api/products/admin/:id
 * @access  Private/Admin
 */
export const getAdminProductById = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id).lean();
  if (!product) throw new ApiError(404, 'Product not found.');
  res.json({ success: true, data: { product } });
});

// ===========================================================================
// Inventory
// ===========================================================================

/**
 * @desc    Inventory overview with low-stock and out-of-stock counts
 * @route   GET /api/products/admin/inventory
 * @access  Private/Admin
 */
export const getInventory = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req.query, { defaultLimit: 25, maxLimit: 100 });

  const filter = {};
  if (req.query.search) {
    const rx = new RegExp(escapeRegex(req.query.search.trim()), 'i');
    filter.$or = [{ name: rx }, { sku: rx }];
  }
  if (req.query.status === 'low') filter.$expr = { $lte: ['$stock', '$lowStockAlert'] };
  if (req.query.status === 'out') filter.stock = { $lte: 0 };

  const [items, total, summary] = await Promise.all([
    Product.find(filter)
      .select('name sku thumbnail stock lowStockAlert availability price costPrice variants isActive')
      .sort(req.query.sort ? buildSortOptions(req.query.sort) : { stock: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Product.countDocuments(filter),
    Product.aggregate([
      {
        $group: {
          _id: null,
          totalProducts: { $sum: 1 },
          totalUnits: { $sum: '$stock' },
          outOfStock: { $sum: { $cond: [{ $lte: ['$stock', 0] }, 1, 0] } },
          lowStock: {
            $sum: {
              $cond: [
                { $and: [{ $gt: ['$stock', 0] }, { $lte: ['$stock', '$lowStockAlert'] }] },
                1, 0,
              ],
            },
          },
          stockValue: { $sum: { $multiply: ['$stock', { $ifNull: ['$costPrice', '$price'] }] } },
        },
      },
    ]),
  ]);

  res.json({
    success: true,
    data: {
      items,
      summary: summary[0] || { totalProducts: 0, totalUnits: 0, outOfStock: 0, lowStock: 0, stockValue: 0 },
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
    },
  });
});

/**
 * @desc    Adjust stock for a product or one of its variants
 * @route   PATCH /api/products/:id/stock
 * @access  Private/Admin
 *
 * Accepts either an absolute `stock` value or a relative `adjust` delta —
 * "received 20 more units" is a delta, "stocktake says 43" is absolute.
 */
export const updateStock = asyncHandler(async (req, res) => {
  const { stock, adjust, variantId, lowStockAlert, availability } = req.body;

  const product = await Product.findById(req.params.id);
  if (!product) throw new ApiError(404, 'Product not found.');

  if (variantId) {
    const variant = product.variants.id(variantId);
    if (!variant) throw new ApiError(404, 'Variant not found.');
    if (stock !== undefined) variant.stock = Math.max(0, Number(stock));
    if (adjust !== undefined) variant.stock = Math.max(0, variant.stock + Number(adjust));
    // Keep the parent total in sync with the sum of its variants
    product.stock = product.variants.reduce((sum, v) => sum + (v.stock || 0), 0);
  } else {
    if (stock !== undefined) product.stock = Math.max(0, Number(stock));
    if (adjust !== undefined) product.stock = Math.max(0, product.stock + Number(adjust));
  }

  if (lowStockAlert !== undefined) product.lowStockAlert = Math.max(0, Number(lowStockAlert));
  if (availability) product.availability = availability;
  else if (product.stock <= 0 && product.availability === 'in_stock') product.availability = 'out_of_stock';
  else if (product.stock > 0 && product.availability === 'out_of_stock') product.availability = 'in_stock';

  await product.save();

  res.json({
    success: true,
    message: 'Stock updated.',
    data: { product: { _id: product._id, stock: product.stock, availability: product.availability, variants: product.variants } },
  });
});

// ===========================================================================
// CSV import / export
// ===========================================================================

const EXPORT_COLUMNS = [
  'name', 'slug', 'sku', 'barcode', 'shortDescription', 'longDescription',
  'category', 'subcategory', 'brand', 'tags',
  'price', 'mrp', 'costPrice', 'tax', 'stock', 'lowStockAlert', 'availability',
  'thumbnail', 'images', 'videoUrl', 'features', 'specifications',
  'seoTitle', 'seoDescription', 'seoKeywords',
  'isActive', 'isFeatured', 'isNewArrival', 'isBestSeller', 'isTrending', 'isFlashDeal',
];

/**
 * @desc    Export the catalogue as CSV
 * @route   GET /api/products/admin/export
 * @access  Private/Admin
 */
export const exportProducts = asyncHandler(async (req, res) => {
  const products = await Product.find({})
    .populate('category', 'name')
    .populate('subcategory', 'name')
    .populate('brand', 'name')
    .lean();

  const rows = products.map((p) => ({
    name: p.name,
    slug: p.slug,
    sku: p.sku || '',
    barcode: p.barcode || '',
    shortDescription: p.shortDescription || '',
    longDescription: p.longDescription || '',
    category: p.category?.name || '',
    subcategory: p.subcategory?.name || '',
    brand: p.brand?.name || '',
    tags: (p.tags || []).join('|'),
    price: p.price,
    mrp: p.mrp || '',
    costPrice: p.costPrice || '',
    tax: p.tax || 0,
    stock: p.stock,
    lowStockAlert: p.lowStockAlert,
    availability: p.availability,
    thumbnail: p.thumbnail || '',
    images: (p.images || []).join('|'),
    videoUrl: p.videoUrl || '',
    features: (p.features || []).join('|'),
    // "Weight:500g|Material:Nylon" — round-trips through the importer
    specifications: Object.entries(p.specifications || {}).map(([k, v]) => `${k}:${v}`).join('|'),
    seoTitle: p.seo?.title || '',
    seoDescription: p.seo?.description || '',
    seoKeywords: p.seo?.keywords || '',
    isActive: p.isActive,
    isFeatured: p.isFeatured,
    isNewArrival: p.isNewArrival,
    isBestSeller: p.isBestSeller,
    isTrending: p.isTrending,
    isFlashDeal: p.isFlashDeal,
  }));

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="aniliving-products-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(toCsv(rows, EXPORT_COLUMNS));
});

/**
 * @desc    Import products from CSV text
 * @route   POST /api/products/admin/import
 * @access  Private/Admin
 *
 * Body: { csv: "<raw csv text>", updateExisting: true }
 * Matching is by SKU first, then slug — so re-importing an edited export
 * updates rather than duplicates.
 */
export const importProducts = asyncHandler(async (req, res) => {
  const { csv, updateExisting = true } = req.body;
  if (!csv || typeof csv !== 'string') throw new ApiError(400, 'Please upload a CSV file.');

  const rows = parseCsv(csv);
  if (!rows.length) throw new ApiError(400, 'The CSV file has no data rows.');
  if (rows.length > 5000) throw new ApiError(400, 'Please import at most 5000 rows at a time.');

  // Resolve category/brand names to ids once, up front
  const [categories, brands] = await Promise.all([
    Category.find({}).select('name').lean(),
    Brand.find({}).select('name').lean(),
  ]);
  const catByName = new Map(categories.map((c) => [c.name.toLowerCase(), c._id]));
  const brandByName = new Map(brands.map((b) => [b.name.toLowerCase(), b._id]));

  const bool = (v) => ['true', '1', 'yes', 'y'].includes(String(v).toLowerCase());
  const list = (v) => String(v || '').split('|').map((s) => s.trim()).filter(Boolean);

  const result = { created: 0, updated: 0, skipped: 0, errors: [] };

  for (const [index, row] of rows.entries()) {
    const lineNo = index + 2; // +1 for header, +1 for 1-based
    try {
      if (!row.name?.trim()) { result.skipped += 1; result.errors.push(`Row ${lineNo}: missing name`); continue; }
      if (row.price === '' || Number.isNaN(Number(row.price))) {
        result.skipped += 1; result.errors.push(`Row ${lineNo}: missing or invalid price`); continue;
      }

      const categoryId = catByName.get(String(row.category || '').toLowerCase());
      if (!categoryId) {
        result.skipped += 1;
        result.errors.push(`Row ${lineNo}: category "${row.category}" does not exist — create it first`);
        continue;
      }

      const specifications = {};
      for (const pair of list(row.specifications)) {
        const idx = pair.indexOf(':');
        if (idx > 0) specifications[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
      }

      const doc = {
        name: row.name.trim(),
        sku: row.sku || undefined,
        barcode: row.barcode || undefined,
        shortDescription: row.shortDescription || '',
        longDescription: row.longDescription || '',
        category: categoryId,
        subcategory: catByName.get(String(row.subcategory || '').toLowerCase()),
        brand: brandByName.get(String(row.brand || '').toLowerCase()),
        tags: list(row.tags),
        price: Number(row.price),
        mrp: row.mrp ? Number(row.mrp) : undefined,
        costPrice: row.costPrice ? Number(row.costPrice) : undefined,
        tax: row.tax ? Number(row.tax) : 0,
        stock: row.stock ? Number(row.stock) : 0,
        lowStockAlert: row.lowStockAlert ? Number(row.lowStockAlert) : 5,
        availability: row.availability || 'in_stock',
        thumbnail: row.thumbnail || '',
        images: list(row.images),
        videoUrl: row.videoUrl || '',
        features: list(row.features),
        specifications,
        seo: {
          title: row.seoTitle || '',
          description: row.seoDescription || '',
          keywords: row.seoKeywords || '',
        },
        isActive: row.isActive === '' ? true : bool(row.isActive),
        isFeatured: bool(row.isFeatured),
        isNewArrival: bool(row.isNewArrival),
        isBestSeller: bool(row.isBestSeller),
        isTrending: bool(row.isTrending),
        isFlashDeal: bool(row.isFlashDeal),
      };

      if (doc.mrp && doc.mrp > doc.price) {
        doc.discount = Math.round(((doc.mrp - doc.price) / doc.mrp) * 100);
      }

      const existing = await Product.findOne(
        row.sku ? { sku: row.sku } : { slug: row.slug || '__none__' },
      );

      if (existing) {
        if (!updateExisting) { result.skipped += 1; continue; }
        await Product.findByIdAndUpdate(existing._id, doc, { runValidators: true });
        result.updated += 1;
      } else {
        doc.slug = await createUniqueSlug(Product, row.slug?.trim() || doc.name);
        await Product.create(doc);
        result.created += 1;
      }
    } catch (err) {
      result.skipped += 1;
      result.errors.push(`Row ${lineNo}: ${err.message}`);
    }
  }

  invalidateSitemap();

  res.json({
    success: true,
    message: `Import finished — ${result.created} created, ${result.updated} updated, ${result.skipped} skipped.`,
    data: { ...result, errors: result.errors.slice(0, 50) },
  });
});

// ===========================================================================
// Facets
// ===========================================================================

/**
 * Build the filter facets for a query.
 *
 * Facets are computed against the query *minus* the facet's own dimension, so
 * un-picking a brand you already selected is still possible — the standard
 * behaviour of faceted search on Amazon/Flipkart.
 */
async function buildFacets(query) {
  const baseFor = (exclude) => {
    const stripped = { ...query };
    delete stripped[exclude];
    delete stripped.page;
    delete stripped.limit;
    delete stripped.sort;
    return buildProductFilters(stripped);
  };

  try {
    const [priceStats, brandAgg, categoryAgg, attributeAgg, ratingAgg, tagAgg] = await Promise.all([
      Product.aggregate([
        { $match: baseFor('minPrice') },
        { $group: { _id: null, min: { $min: '$price' }, max: { $max: '$price' } } },
      ]),
      Product.aggregate([
        { $match: baseFor('brand') },
        { $group: { _id: '$brand', count: { $sum: 1 } } },
        { $match: { _id: { $ne: null } } },
        { $lookup: { from: 'brands', localField: '_id', foreignField: '_id', as: 'b' } },
        { $unwind: '$b' },
        { $project: { _id: 1, name: '$b.name', slug: '$b.slug', logo: '$b.logo', count: 1 } },
        { $sort: { count: -1 } },
      ]),
      Product.aggregate([
        { $match: baseFor('category') },
        { $group: { _id: '$category', count: { $sum: 1 } } },
        { $match: { _id: { $ne: null } } },
        { $lookup: { from: 'categories', localField: '_id', foreignField: '_id', as: 'c' } },
        { $unwind: '$c' },
        { $project: { _id: 1, name: '$c.name', slug: '$c.slug', parent: '$c.parent', count: 1 } },
        { $sort: { count: -1 } },
      ]),
      // Dynamic attributes — whatever the admin has defined, nothing hardcoded
      Product.aggregate([
        { $match: buildProductFilters({ ...query, page: undefined, limit: undefined }) },
        { $unwind: '$attributes' },
        { $unwind: '$attributes.values' },
        { $group: { _id: { name: '$attributes.name', value: '$attributes.values' }, count: { $sum: 1 } } },
        {
          $group: {
            _id: '$_id.name',
            values: { $push: { value: '$_id.value', count: '$count' } },
            total: { $sum: '$count' },
          },
        },
        { $sort: { total: -1 } },
        { $limit: 12 },
      ]),
      Product.aggregate([
        { $match: baseFor('rating') },
        { $group: { _id: { $floor: '$ratingsAverage' }, count: { $sum: 1 } } },
        { $sort: { _id: -1 } },
      ]),
      Product.aggregate([
        { $match: baseFor('tags') },
        { $unwind: '$tags' },
        { $group: { _id: '$tags', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 20 },
      ]),
    ]);

    return {
      priceRange: {
        min: Math.floor(priceStats[0]?.min ?? 0),
        max: Math.ceil(priceStats[0]?.max ?? 0),
      },
      brands: brandAgg,
      categories: categoryAgg,
      ratings: ratingAgg.filter((r) => r._id > 0),
      tags: tagAgg.map((t) => ({ value: t._id, count: t.count })),
      attributes: attributeAgg.map((a) => ({
        name: a._id,
        values: a.values.sort((x, y) => y.count - x.count),
      })),
    };
  } catch (err) {
    console.error('Facet generation failed:', err.message);
    return { priceRange: { min: 0, max: 0 }, brands: [], categories: [], ratings: [], tags: [], attributes: [] };
  }
}
