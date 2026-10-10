import Product from '../models/Product.js';
import Category from '../models/Category.js';
import Order from '../models/Order.js';
import { asyncHandler } from '../utils/helpers.js';
import { ApiError } from '../middleware/errorHandler.js';
import {
  createCheckoutAccessToken,
  getFastrrOrderDetails,
  syncFastrrOrder,
  formatProductForFastrr,
  formatCategoryForFastrr,
  findCategoryByFastrrIntId,
} from '../services/fastrrService.js';

/**
 * ============================================================================
 * STOREFRONT CHECKOUT ENDPOINTS
 * ============================================================================
 */

/**
 * @desc    Generate Fastrr Checkout Access Token
 * @route   POST /api/fastrr/checkout-token
 * @access  Public
 */
export const generateCheckoutToken = asyncHandler(async (req, res) => {
  const { items, redirectUrl } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    throw new ApiError(400, 'No items provided for checkout.');
  }

  // Verify that products exist and are active
  const validatedItems = [];
  for (const item of items) {
    const productId = item.productId || item.product?._id || item.id;
    if (!productId) continue;

    const product = await Product.findById(productId);
    if (!product || !product.isActive) {
      throw new ApiError(400, `Item "${item.name || productId}" is no longer available.`);
    }

    const qty = Math.max(1, parseInt(item.quantity, 10) || 1);
    const variantId = item.variantId || item.variant?._id || null;

    validatedItems.push({
      productId: String(product._id),
      variantId: variantId ? String(variantId) : String(product._id),
      quantity: qty,
    });
  }

  if (validatedItems.length === 0) {
    throw new ApiError(400, 'All selected items are invalid or out of stock.');
  }

  let result;
  try {
    result = await createCheckoutAccessToken({
      items: validatedItems,
      redirectUrl,
    });
  } catch (err) {
    console.error('Fastrr token generation failed:', err?.message || err);
    throw new ApiError(502, 'Error from payment provider. Please try again.');
  }

  res.json({
    success: true,
    data: {
      token: result.token,
      orderId: result.orderId,
      expiresAt: result.expiresAt,
    },
  });
});

/**
 * @desc    Get order details for storefront redirect (OrderSuccessPage)
 * @route   GET /api/fastrr/order/:oid
 * @access  Public
 */
export const getFastrrOrder = asyncHandler(async (req, res) => {
  const { oid } = req.params;
  if (!oid) {
    throw new ApiError(400, 'Fastrr order ID is required.');
  }

  // 1. Look up in local database
  let order = await Order.findOne({ fastrrOrderId: oid })
    .populate('user', 'firstName lastName email phone')
    .populate('items.product', 'name slug thumbnail');

  // 2. If not found yet, query Fastrr order details API directly and sync
  if (!order) {
    try {
      const fastrrDetails = await getFastrrOrderDetails(oid);
      if (fastrrDetails) {
        order = await syncFastrrOrder(fastrrDetails);
        order = await Order.findById(order._id)
          .populate('user', 'firstName lastName email phone')
          .populate('items.product', 'name slug thumbnail');
      }
    } catch (err) {
      console.error(`Could not fetch Fastrr order ${oid}:`, err.message);
    }
  }

  if (!order) {
    throw new ApiError(404, 'Order not found or processing.');
  }

  res.json({
    success: true,
    data: { order },
  });
});

/**
 * ============================================================================
 * FASTRR WEBHOOKS (Incoming from Fastrr to Seller)
 * ============================================================================
 */

/**
 * @desc    Order Webhook from Fastrr
 * @route   POST /api/fastrr/webhook/order
 * @access  Public (Called by Fastrr servers)
 */
export const handleOrderWebhook = asyncHandler(async (req, res) => {
  const orderData = req.body;
  if (!orderData || (!orderData.order_id && !orderData.platform_order_id)) {
    return res.status(400).json({ ok: false, error: 'Missing order_id' });
  }

  try {
    const order = await syncFastrrOrder(orderData);
    return res.status(200).json({
      ok: true,
      result: true,
      orderNumber: order.orderNumber,
    });
  } catch (err) {
    console.error('Error handling Fastrr order webhook:', err);
    // Respond with 200 so Fastrr does not endlessly retry non-recoverable errors
    return res.status(200).json({
      ok: false,
      error: err.message,
    });
  }
});

/**
 * ============================================================================
 * SELLER APIS (Implemented by Seller, Called by Fastrr)
 * ============================================================================
 */

/**
 * Helper to parse pagination params from query.
 * Supports both styles Fastrr may send:
 *   - Page-based:   ?page=1&limit=12   (page is 1-indexed)
 *   - Offset-based: ?limit=12&offset=0
 *
 * If `offset` is present it takes priority over `page`.
 */
const getPagination = (req) => {
  const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 12));

  let skip;
  if (req.query.offset !== undefined) {
    // Offset-based: ?limit=12&offset=24
    skip = Math.max(0, parseInt(req.query.offset, 10) || 0);
  } else {
    // Page-based: ?page=1&limit=12  (1-indexed; page=0 treated same as page=1)
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    skip = (page - 1) * limit;
  }

  return { limit, skip };
};

/**
 * @desc    Fetch Products for Fastrr Catalog
 * @route   GET /api/fastrr/products
 * @access  Public
 */
export const getFastrrProducts = asyncHandler(async (req, res) => {
  const { limit, skip } = getPagination(req);

  const filter = { isActive: true };
  const total = await Product.countDocuments(filter);
  const products = await Product.find(filter)
    .populate('category', 'name slug')
    .populate('brand', 'name slug')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

  const formatted = products.map(formatProductForFastrr);

  res.json({
    data: {
      total,
      products: formatted,
    },
  });
});

/**
 * @desc    Fetch Products by Collection for Fastrr Catalog
 * @route   GET /api/fastrr/collections/:collection_id/products
 * @route   GET /api/fastrr/collection-products
 * @access  Public
 */
export const getFastrrProductsByCollection = asyncHandler(async (req, res) => {
  const collectionId = req.params.collection_id || req.query.collection_id;
  const { limit, skip } = getPagination(req);

  let category = null;
  if (collectionId) {
    category = await findCategoryByFastrrIntId(collectionId);
    // If a collectionId was provided but not found, return empty results
    if (!category) {
      return res.json({
        data: {
          total: 0,
          products: [],
        },
      });
    }
  }

  const filter = { isActive: true };
  if (category) {
    // Include products mapped directly to this category or its subcategories
    const subcats = await Category.find({ parent: category._id }).select('_id');
    const catIds = [category._id, ...subcats.map((s) => s._id)];
    filter.$or = [{ category: { $in: catIds } }, { subcategory: { $in: catIds } }];
  }

  const total = await Product.countDocuments(filter);
  const products = await Product.find(filter)
    .populate('category', 'name slug')
    .populate('brand', 'name slug')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

  const formatted = products.map(formatProductForFastrr);

  res.json({
    data: {
      total,
      products: formatted,
    },
  });
});

/**
 * @desc    Fetch Collections for Fastrr Catalog
 * @route   GET /api/fastrr/collections
 * @access  Public
 */
export const getFastrrCollections = asyncHandler(async (req, res) => {
  const { limit, skip } = getPagination(req);

  const filter = { isActive: { $ne: false } };
  const total = await Category.countDocuments(filter);
  const categories = await Category.find(filter)
    .sort({ sortOrder: 1, name: 1 })
    .skip(skip)
    .limit(limit);

  const formatted = categories.map(formatCategoryForFastrr);

  res.json({
    data: {
      total,
      collections: formatted,
    },
  });
});

/**
 * ============================================================================
 * LOYALTY POINTS MANAGER (APIs called by Fastrr)
 * ============================================================================
 */

/**
 * @desc    Fetch Loyalty Points
 * @route   POST /api/fastrr/loyalty/points
 * @access  Public
 */
export const fetchLoyaltyPoints = asyncHandler(async (req, res) => {
  const { mobile_number } = req.body;
  // If a loyalty points system is configured in the future, read user points here.
  // Default provides valid response expected by Fastrr.
  res.json({
    data: {
      mobile_number: mobile_number || '',
      available_points: 0,
      applicable_points: 0,
    },
  });
});

/**
 * @desc    Block Loyalty Points
 * @route   POST /api/fastrr/loyalty/block
 * @access  Public
 */
export const blockLoyaltyPoints = asyncHandler(async (req, res) => {
  const { mobile_number, transactional_points, order_id } = req.body;
  res.json({
    data: {
      available_points: 0,
      debited_points: transactional_points || 0,
      status: true,
      message: 'Valid Customer Id',
      transaction_id: `LP_${order_id || Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    },
  });
});

/**
 * @desc    Unblock Loyalty Points
 * @route   POST /api/fastrr/loyalty/unblock
 * @access  Public
 */
export const unblockLoyaltyPoints = asyncHandler(async (req, res) => {
  res.json({
    data: {
      status: 'Success',
    },
  });
});
