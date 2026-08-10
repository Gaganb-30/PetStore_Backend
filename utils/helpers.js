/**
 * Async handler wrapper — eliminates try/catch in every controller
 * Usage: router.get('/', asyncHandler(async (req, res) => { ... }))
 */
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/** Escape a user-supplied string so it is safe to embed in a RegExp */
export const escapeRegex = (str = '') => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Normalise "a,b" | ["a","b"] | "a" into a clean array */
export const toArray = (value) => {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) return value.flatMap((v) => String(v).split(',')).map((v) => v.trim()).filter(Boolean);
  return String(value).split(',').map((v) => v.trim()).filter(Boolean);
};

/**
 * Build a MongoDB filter object from query params.
 *
 * Everything here is data-driven: attribute filters arrive as `attr_<Name>` so
 * a brand-new attribute the admin invents tomorrow ("Flavour", "Breed Size")
 * filters correctly without a code change.
 *
 * Supported: search, category, subcategory, brand, price range, rating, tags,
 * availability, in-stock only, feature flags and dynamic attributes.
 */
export const buildProductFilters = (query, { includeInactive = false } = {}) => {
  const filters = includeInactive ? {} : { isActive: true };
  const and = [];

  // Free-text search. A regex on an indexed-ish field beats $text here because
  // it also matches partial words ("cat" → "catnip"), which shoppers expect.
  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search.trim()), 'i');
    and.push({ $or: [{ name: rx }, { shortDescription: rx }, { tags: rx }, { sku: rx }] });
  }

  const categories = toArray(query.category);
  if (categories.length === 1) filters.category = categories[0];
  else if (categories.length > 1) filters.category = { $in: categories };

  const subcategories = toArray(query.subcategory);
  if (subcategories.length === 1) filters.subcategory = subcategories[0];
  else if (subcategories.length > 1) filters.subcategory = { $in: subcategories };

  const brands = toArray(query.brand);
  if (brands.length === 1) filters.brand = brands[0];
  else if (brands.length > 1) filters.brand = { $in: brands };

  if (query.minPrice || query.maxPrice) {
    filters.price = {};
    if (query.minPrice) filters.price.$gte = Number(query.minPrice);
    if (query.maxPrice) filters.price.$lte = Number(query.maxPrice);
  }

  if (query.rating) filters.ratingsAverage = { $gte: Number(query.rating) };

  const tags = toArray(query.tags);
  if (tags.length) filters.tags = { $in: tags };

  if (query.availability) filters.availability = query.availability;

  // "In stock only" — a product counts as in stock if the base stock is
  // positive OR any variant still has units left.
  if (query.inStock === 'true') {
    and.push({
      availability: { $nin: ['out_of_stock', 'discontinued'] },
      $or: [{ stock: { $gt: 0 } }, { 'variants.stock': { $gt: 0 } }],
    });
  }

  // Feature flags
  for (const flag of ['isFeatured', 'isNewArrival', 'isBestSeller', 'isTrending', 'isFlashDeal']) {
    if (query[flag] !== undefined && query[flag] !== '') filters[flag] = query[flag] === 'true';
  }
  if (query.isActive !== undefined && query.isActive !== '') filters.isActive = query.isActive === 'true';

  // ---------------------------------------------------------------------
  // Dynamic attributes: ?attr_Color=Red,Blue&attr_Size=Large
  // Each attribute is ANDed, values within one attribute are ORed —
  // the behaviour shoppers expect from faceted navigation.
  // ---------------------------------------------------------------------
  for (const [key, rawValue] of Object.entries(query)) {
    if (!key.startsWith('attr_')) continue;
    const name = key.slice(5);
    const values = toArray(rawValue);
    if (!name || !values.length) continue;
    and.push({
      $or: [
        { attributes: { $elemMatch: { name, values: { $in: values } } } },
        { [`specifications.${name}`]: { $in: values } },
      ],
    });
  }

  if (and.length) filters.$and = and;
  return filters;
};

/**
 * Build sort object from query param
 */
export const buildSortOptions = (sortQuery) => {
  const sortOptions = {
    price_asc: { price: 1 },
    price_desc: { price: -1 },
    newest: { createdAt: -1 },
    oldest: { createdAt: 1 },
    rating: { ratingsAverage: -1, ratingsCount: -1 },
    name_asc: { name: 1 },
    name_desc: { name: -1 },
    popular: { ratingsCount: -1, ratingsAverage: -1 },
    discount: { discount: -1 },
    stock_asc: { stock: 1 },
    stock_desc: { stock: -1 },
  };
  return sortOptions[sortQuery] || { createdAt: -1 };
};

/**
 * Paginate results
 */
export const paginate = (query, { maxLimit = 60, defaultLimit = 12 } = {}) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(query.limit, 10) || defaultLimit));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

/**
 * Collapse a product's variants into the colour swatches the product card
 * renders. Returns one entry per distinct colour with the image to show when
 * that swatch is selected — this is what lets a shirt in five colours occupy a
 * single card instead of five.
 */
export const buildColorOptions = (product) => {
  if (!product?.variants?.length) return [];

  // Find whichever attribute is acting as the colour axis
  const colorKey = (product.attributes || [])
    .map((a) => a.name)
    .find((n) => /colou?r|shade/i.test(n)) || 'Color';

  const seen = new Map();
  for (const variant of product.variants) {
    if (variant.isActive === false) continue;
    const combo = variant.attributeCombination instanceof Map
      ? Object.fromEntries(variant.attributeCombination)
      : (variant.attributeCombination || {});
    const value = combo[colorKey] || Object.entries(combo)
      .find(([k]) => /colou?r|shade/i.test(k))?.[1];
    if (!value || seen.has(value)) continue;

    seen.set(value, {
      name: colorKey,
      value,
      image: variant.images?.[0] || product.thumbnail,
      images: variant.images?.length ? variant.images : undefined,
      price: variant.price,
      mrp: variant.mrp,
      stock: variant.stock,
      variantId: variant._id,
    });
  }
  return [...seen.values()];
};
