import crypto from 'crypto';
import Razorpay from 'razorpay';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import Cart from '../models/Cart.js';
import Coupon from '../models/Coupon.js';
import Settings from '../models/Settings.js';
import PaymentLog from '../models/PaymentLog.js';
import { asyncHandler } from '../utils/helpers.js';
import { ApiError } from '../middleware/errorHandler.js';
import { sendOrderConfirmation, sendOrderStatusUpdate } from '../services/emailService.js';
import { streamInvoice } from '../services/invoiceService.js';
import config, { isRazorpayConfigured } from '../config/index.js';

// ---------------------------------------------------------------------------
// Razorpay client — only instantiated when keys are configured, so the server
// still boots (and COD still works) on a machine without payment credentials.
// ---------------------------------------------------------------------------
let razorpay;
if (isRazorpayConfigured()) {
  razorpay = new Razorpay({
    key_id: config.razorpay.keyId,
    key_secret: config.razorpay.keySecret,
  });
}

const requireRazorpay = () => {
  if (!isRazorpayConfigured() || !razorpay) {
    throw new ApiError(400, 'Online payments are currently unavailable because Razorpay credentials are not configured. Please choose Cash on Delivery.');
  }
  return razorpay;
};

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Resolve the authoritative price and stock for a cart line.
 * Prices are always recomputed from the database at checkout time — a cart can
 * sit in a browser for weeks, and we must never bill the stale price it holds.
 */
const resolveLine = (product, variantId) => {
  if (variantId && product.variants?.length) {
    const variant = product.variants.id(variantId);
    if (!variant || !variant.isActive) {
      return { error: `The selected option for "${product.name}" is no longer available.` };
    }
    return { price: variant.price, stock: variant.stock, sku: variant.sku || product.sku, variant };
  }
  return { price: product.price, stock: product.stock, sku: product.sku, variant: null };
};

/** Adjust stock for a product or, when the line is a variant, for that variant. */
const adjustStock = async (productId, variantId, delta) => {
  if (variantId) {
    await Product.updateOne(
      { _id: productId, 'variants._id': variantId },
      { $inc: { 'variants.$.stock': delta, stock: delta } },
    );
  } else {
    await Product.updateOne({ _id: productId }, { $inc: { stock: delta } });
  }
};

// ===========================================================================
// Checkout
// ===========================================================================

/**
 * @desc    Create order from the user's cart
 * @route   POST /api/orders
 * @access  Private
 */
export const createOrder = asyncHandler(async (req, res) => {
  const { shippingAddress, paymentMethod, couponCode, customerNote, directItem } = req.body;
  const settings = await Settings.getSettings();

  // Address and phone are mandatory before any order can be placed.
  const required = ['fullName', 'phone', 'addressLine1', 'city', 'state', 'pincode'];
  const missing = required.filter((f) => !shippingAddress?.[f]?.toString().trim());
  if (missing.length) {
    throw new ApiError(400, `Delivery address is incomplete. Missing: ${missing.join(', ')}.`);
  }
  if (!/^[6-9]\d{9}$/.test(String(shippingAddress.phone).replace(/\D/g, '').slice(-10))) {
    throw new ApiError(400, 'Please provide a valid 10-digit mobile number for delivery updates.');
  }

  let cart = null;
  let activeItems = [];
  const isDirectBuy = Boolean(directItem?.productId);

  if (isDirectBuy) {
    const product = await Product.findById(directItem.productId);
    if (!product || !product.isActive) {
      throw new ApiError(400, 'This product is no longer available.');
    }
    const quantity = Math.max(1, parseInt(directItem.quantity, 10) || 1);
    activeItems = [{
      product,
      variantId: directItem.variantId || null,
      variant: directItem.variant || null,
      quantity,
    }];
  } else {
    cart = await Cart.findOne({ user: req.user._id }).populate('items.product');
    if (!cart || cart.items.length === 0) {
      throw new ApiError(400, 'Your cart is empty.');
    }

    activeItems = cart.items.filter((item) => !item.savedForLater);
    if (activeItems.length === 0) {
      throw new ApiError(400, 'No active items in your cart.');
    }
  }

  // -------------------------------------------------------------------
  // Validate stock and rebuild the order from live product data
  // -------------------------------------------------------------------
  const orderItems = [];
  let itemsPrice = 0;

  for (const cartItem of activeItems) {
    const product = cartItem.product;
    if (!product || !product.isActive) {
      throw new ApiError(400, 'One of the products in your cart is no longer available.');
    }
    if (product.availability === 'out_of_stock' || product.availability === 'discontinued') {
      throw new ApiError(400, `"${product.name}" is currently unavailable.`);
    }

    const line = resolveLine(product, cartItem.variantId);
    if (line.error) throw new ApiError(400, line.error);
    if (line.stock < cartItem.quantity) {
      throw new ApiError(400, `Only ${line.stock} unit(s) of "${product.name}" left in stock.`);
    }

    orderItems.push({
      product: product._id,
      name: product.name,
      thumbnail: line.variant?.images?.[0] || product.thumbnail,
      variant: cartItem.variant,
      variantId: cartItem.variantId,
      sku: line.sku,
      price: line.price,
      quantity: cartItem.quantity,
    });

    itemsPrice += line.price * cartItem.quantity;
  }

  itemsPrice = round2(itemsPrice);

  if (settings.minOrderValue && itemsPrice < settings.minOrderValue) {
    throw new ApiError(400, `Minimum order value is ₹${settings.minOrderValue}.`);
  }

  // -------------------------------------------------------------------
  // Coupon → discount → tax → shipping → total
  // -------------------------------------------------------------------
  let discountAmount = 0;
  let couponData = null;
  let couponDoc = null;
  if (couponCode) {
    couponDoc = await Coupon.findOne({ code: couponCode.toUpperCase() });
    if (!couponDoc) throw new ApiError(400, 'Invalid coupon code.');
    const validation = couponDoc.isValid(itemsPrice, req.user._id);
    if (!validation.valid) throw new ApiError(400, validation.message);
    discountAmount = round2(couponDoc.calculateDiscount(itemsPrice));
    couponData = { code: couponDoc.code, discount: discountAmount };
  }

  const taxableAmount = Math.max(0, itemsPrice - discountAmount);
  // Product prices entered in admin are already inclusive of GST and all taxes.
  // Calculate embedded GST portion for records and invoice:
  const taxRate = Number(settings.taxRate) || 0;
  const taxPrice = taxRate > 0 ? round2(taxableAmount - (taxableAmount / (1 + taxRate / 100))) : 0;

  const shippingPrice = 0; // Free delivery on all orders regardless of amount

  const totalPrice = round2(taxableAmount + shippingPrice);

  if (paymentMethod === 'cod' && !settings.codEnabled) {
    throw new ApiError(400, 'Cash on Delivery is not available right now.');
  }
  if (!['cod', 'razorpay'].includes(paymentMethod)) {
    throw new ApiError(400, 'Unsupported payment method.');
  }
  if (paymentMethod === 'razorpay') requireRazorpay();

  // -------------------------------------------------------------------
  // Persist the order
  // -------------------------------------------------------------------
  const order = await Order.create({
    user: req.user._id,
    items: orderItems,
    shippingAddress,
    paymentMethod,
    itemsPrice,
    taxPrice,
    shippingPrice,
    discountAmount,
    totalPrice,
    coupon: couponData,
    customerNote,
    status: paymentMethod === 'cod' ? 'confirmed' : 'pending',
    statusHistory: [{
      status: paymentMethod === 'cod' ? 'confirmed' : 'pending',
      note: paymentMethod === 'cod' ? 'Order placed (Cash on Delivery)' : 'Awaiting payment',
    }],
    isPaid: false,
  });

  // Razorpay checkout order
  let razorpayOrder = null;
  if (paymentMethod === 'razorpay') {
    try {
      razorpayOrder = await razorpay.orders.create({
        amount: Math.round(totalPrice * 100), // paise
        currency: 'INR',
        receipt: order.orderNumber,
        notes: { orderId: order._id.toString(), userId: req.user._id.toString() },
      });
    } catch (rzpErr) {
      console.error('Razorpay order creation failed:', rzpErr);
      await Order.findByIdAndDelete(order._id);
      const desc = rzpErr.error?.description || rzpErr.message || 'Payment initiation failed';
      throw new ApiError(400, `Online payment failed: ${desc}. Please choose Cash on Delivery.`);
    }

    order.paymentResult = { razorpayOrderId: razorpayOrder.id, status: 'created' };
    await order.save();

    PaymentLog.record({
      order: order._id,
      orderNumber: order.orderNumber,
      user: req.user._id,
      source: 'checkout',
      event: 'order.created',
      status: 'created',
      razorpayOrderId: razorpayOrder.id,
      amount: totalPrice,
    });
  }

  // Reserve stock
  for (const item of orderItems) {
    await adjustStock(item.product, item.variantId, -item.quantity);
  }

  // Consume one coupon use
  if (couponDoc) {
    couponDoc.usedCount += 1;
    couponDoc.usedBy.push({ user: req.user._id });
    await couponDoc.save();
  }

  // Empty the cart only if ordered via cart, keeping saved-for-later items. Direct Buy Now preserves cart.
  if (!isDirectBuy && cart) {
    cart.items = cart.items.filter((item) => item.savedForLater);
    cart.coupon = undefined;
    await cart.save();
  }

  // COD orders are confirmed immediately, so mail the confirmation now.
  if (paymentMethod === 'cod') sendOrderConfirmation(req.user, order);

  res.status(201).json({
    success: true,
    message: 'Order placed successfully.',
    data: {
      order,
      razorpayOrder: razorpayOrder ? {
        id: razorpayOrder.id,
        amount: razorpayOrder.amount,
        currency: razorpayOrder.currency,
        key: config.razorpay.keyId,
      } : null,
    },
  });
});

/**
 * @desc    Verify a Razorpay payment returned by the checkout widget
 * @route   POST /api/orders/:id/verify-payment
 * @access  Private
 */
export const verifyPayment = asyncHandler(async (req, res) => {
  const { razorpayPaymentId, razorpayOrderId, razorpaySignature } = req.body;

  const order = await Order.findById(req.params.id);
  if (!order) throw new ApiError(404, 'Order not found.');
  if (order.user.toString() !== req.user._id.toString()) {
    throw new ApiError(403, 'Not authorized.');
  }

  // The signature is HMAC(order_id|payment_id, key_secret). Recomputing it
  // server-side is what stops a client from claiming an unpaid order is paid.
  const expectedSignature = crypto
    .createHmac('sha256', config.razorpay.keySecret)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest('hex');

  if (expectedSignature !== razorpaySignature) {
    order.paymentResult.status = 'failed';
    order.statusHistory.push({ status: 'pending', note: 'Payment signature verification failed' });
    await order.save();

    PaymentLog.record({
      order: order._id,
      orderNumber: order.orderNumber,
      user: req.user._id,
      source: 'client_verification',
      event: 'payment.signature_mismatch',
      status: 'failed',
      razorpayOrderId,
      razorpayPaymentId,
      amount: order.totalPrice,
      errorDescription: 'Signature mismatch',
    });

    throw new ApiError(400, 'Payment verification failed. If money was deducted it will be refunded automatically.');
  }

  // Idempotent — a webhook may have marked this paid already.
  if (!order.isPaid) {
    order.isPaid = true;
    order.paidAt = new Date();
    order.status = 'confirmed';
    order.statusHistory.push({ status: 'confirmed', note: 'Payment verified via Razorpay' });
    sendOrderConfirmation(req.user, order);
  }

  order.paymentResult = {
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature,
    status: 'paid',
    paidAt: order.paidAt || new Date(),
  };
  await order.save();

  PaymentLog.record({
    order: order._id,
    orderNumber: order.orderNumber,
    user: req.user._id,
    source: 'client_verification',
    event: 'payment.verified',
    status: 'paid',
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature,
    amount: order.totalPrice,
  });

  res.json({ success: true, message: 'Payment verified. Order confirmed.', data: { order } });
});

/**
 * @desc    Create a fresh Razorpay order so the customer can retry a failed payment
 * @route   POST /api/orders/:id/retry-payment
 * @access  Private
 */
export const retryPayment = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) throw new ApiError(404, 'Order not found.');
  if (order.user.toString() !== req.user._id.toString()) {
    throw new ApiError(403, 'Not authorized.');
  }
  if (order.isPaid) throw new ApiError(400, 'This order is already paid.');
  if (order.isCancelled) throw new ApiError(400, 'This order was cancelled and cannot be paid.');
  if (order.paymentMethod !== 'razorpay') throw new ApiError(400, 'This order is not an online payment order.');

  requireRazorpay();

  const razorpayOrder = await razorpay.orders.create({
    amount: Math.round(order.totalPrice * 100),
    currency: 'INR',
    receipt: `${order.orderNumber}-R${Date.now().toString().slice(-6)}`,
    notes: { orderId: order._id.toString(), retry: 'true' },
  });

  order.paymentResult = { razorpayOrderId: razorpayOrder.id, status: 'created' };
  order.statusHistory.push({ status: order.status, note: 'Payment retry initiated' });
  await order.save();

  PaymentLog.record({
    order: order._id,
    orderNumber: order.orderNumber,
    user: req.user._id,
    source: 'checkout',
    event: 'order.retry',
    status: 'created',
    razorpayOrderId: razorpayOrder.id,
    amount: order.totalPrice,
  });

  res.json({
    success: true,
    message: 'Retry your payment.',
    data: {
      order,
      razorpayOrder: {
        id: razorpayOrder.id,
        amount: razorpayOrder.amount,
        currency: razorpayOrder.currency,
        key: config.razorpay.keyId,
      },
    },
  });
});

// ===========================================================================
// Reading orders
// ===========================================================================

/**
 * @desc    Get the signed-in user's orders
 * @route   GET /api/orders/my-orders
 * @access  Private
 */
export const getMyOrders = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = Math.min(50, parseInt(req.query.limit, 10) || 10);
  const skip = (page - 1) * limit;

  const filter = { user: req.user._id };
  if (req.query.status) filter.status = req.query.status;

  const [orders, total] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Order.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: { orders, pagination: { page, limit, total, pages: Math.ceil(total / limit) } },
  });
});

/**
 * @desc    Get a single order
 * @route   GET /api/orders/:id
 * @access  Private (owner or admin)
 */
export const getOrderById = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id)
    .populate('items.product', 'slug thumbnail')
    .populate('user', 'firstName lastName email phone');

  if (!order) throw new ApiError(404, 'Order not found.');

  const ownerId = order.user?._id?.toString() || order.user?.toString();
  if (ownerId !== req.user._id.toString() && req.user.role !== 'admin') {
    throw new ApiError(403, 'Not authorized.');
  }

  res.json({ success: true, data: { order } });
});

/**
 * @desc    Track an order by its order number
 * @route   GET /api/orders/track/:orderNumber
 * @access  Public
 */
export const trackOrder = asyncHandler(async (req, res) => {
  const order = await Order.findOne({ orderNumber: req.params.orderNumber.toUpperCase() })
    .select('orderNumber status statusHistory trackingNumber trackingUrl estimatedDelivery isPaid isDelivered isCancelled createdAt items.name items.quantity items.thumbnail shippingAddress.city shippingAddress.state')
    .lean();

  if (!order) throw new ApiError(404, 'We could not find an order with that number.');

  res.json({ success: true, data: { order } });
});

/**
 * @desc    Download the invoice PDF for an order
 * @route   GET /api/orders/:id/invoice
 * @access  Private (owner or admin)
 */
export const downloadInvoice = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) throw new ApiError(404, 'Order not found.');

  if (order.user.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
    throw new ApiError(403, 'Not authorized.');
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="invoice-${order.orderNumber}.pdf"`);
  await streamInvoice(order, res);
});

/**
 * @desc    Cancel an order (customer side)
 * @route   PATCH /api/orders/:id/cancel
 * @access  Private
 */
export const cancelOrder = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) throw new ApiError(404, 'Order not found.');
  if (order.user.toString() !== req.user._id.toString()) {
    throw new ApiError(403, 'Not authorized.');
  }

  // Once a parcel has left the warehouse, cancellation has to go through support.
  const cancellable = ['pending', 'confirmed', 'processing'];
  if (!cancellable.includes(order.status)) {
    throw new ApiError(400, `An order that is already ${order.status.replace(/_/g, ' ')} cannot be cancelled online. Please contact support.`);
  }

  order.status = 'cancelled';
  order.isCancelled = true;
  order.cancelledAt = new Date();
  order.cancellationReason = req.body.reason || 'Cancelled by customer';
  order.statusHistory.push({ status: 'cancelled', note: order.cancellationReason, updatedBy: req.user._id });
  await order.save();

  // Return the reserved stock
  for (const item of order.items) {
    await adjustStock(item.product, item.variantId, item.quantity);
  }

  sendOrderStatusUpdate(req.user, order);

  res.json({ success: true, message: 'Order cancelled.', data: { order } });
});

// ===========================================================================
// Admin
// ===========================================================================

/**
 * @desc    List all orders with filters (Admin)
 * @route   GET /api/orders
 * @access  Private/Admin
 */
export const getAllOrders = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = Math.min(100, parseInt(req.query.limit, 10) || 20);
  const skip = (page - 1) * limit;

  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.paymentMethod) filter.paymentMethod = req.query.paymentMethod;
  if (req.query.isPaid !== undefined && req.query.isPaid !== '') filter.isPaid = req.query.isPaid === 'true';
  if (req.query.search) {
    const rx = new RegExp(req.query.search.trim(), 'i');
    filter.$or = [
      { orderNumber: rx },
      { 'shippingAddress.fullName': rx },
      { 'shippingAddress.phone': rx },
    ];
  }
  if (req.query.from || req.query.to) {
    filter.createdAt = {};
    if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
    if (req.query.to) filter.createdAt.$lte = new Date(`${req.query.to}T23:59:59.999Z`);
  }

  const [orders, total, statusCounts] = await Promise.all([
    Order.find(filter)
      .populate('user', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Order.countDocuments(filter),
    Order.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
  ]);

  res.json({
    success: true,
    data: {
      orders,
      statusCounts: statusCounts.reduce((acc, s) => ({ ...acc, [s._id]: s.count }), {}),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    },
  });
});

/**
 * @desc    Update order status / tracking details (Admin)
 * @route   PATCH /api/orders/:id/status
 * @access  Private/Admin
 */
export const updateOrderStatus = asyncHandler(async (req, res) => {
  const {
    status, note, trackingNumber, trackingUrl,
    estimatedDelivery, adminNote, courierName,
  } = req.body;

  const order = await Order.findById(req.params.id).populate('user', 'firstName lastName email');
  if (!order) throw new ApiError(404, 'Order not found.');

  const previousStatus = order.status;
  const wasCancelled = order.isCancelled;

  if (status && status !== order.status) {
    order.status = status;
    order.statusHistory.push({ status, note, updatedBy: req.user._id });
  } else if (note) {
    order.statusHistory.push({ status: order.status, note, updatedBy: req.user._id });
  }

  // Tracking fields — admins can set/clear these independently of status
  if (trackingNumber !== undefined) order.trackingNumber = trackingNumber;
  if (trackingUrl !== undefined) order.trackingUrl = trackingUrl;
  if (courierName !== undefined) order.courierName = courierName;
  if (estimatedDelivery !== undefined) {
    order.estimatedDelivery = estimatedDelivery ? new Date(estimatedDelivery) : undefined;
  }
  if (adminNote !== undefined) order.adminNote = adminNote;

  if (order.status === 'delivered') {
    order.isDelivered = true;
    order.deliveredAt = order.deliveredAt || new Date();
    // A delivered COD order has, by definition, been paid.
    if (order.paymentMethod === 'cod' && !order.isPaid) {
      order.isPaid = true;
      order.paidAt = new Date();
    }
  }

  // Restore stock exactly once, the first time an order becomes cancelled/returned
  if (['cancelled', 'returned'].includes(order.status) && !wasCancelled) {
    order.isCancelled = order.status === 'cancelled';
    order.cancelledAt = new Date();
    order.cancellationReason = note || `Marked ${order.status} by admin`;
    for (const item of order.items) {
      await adjustStock(item.product, item.variantId, item.quantity);
    }
  }

  await order.save();

  // Notify the customer whenever the status actually moved
  if (status && status !== previousStatus && order.user?.email) {
    sendOrderStatusUpdate(order.user, order);
  }

  res.json({
    success: true,
    message: `Order updated${status ? ` to ${status.replace(/_/g, ' ')}` : ''}.`,
    data: { order },
  });
});

/**
 * @desc    Payment log for one order (Admin)
 * @route   GET /api/orders/:id/payment-logs
 * @access  Private/Admin
 */
export const getPaymentLogs = asyncHandler(async (req, res) => {
  const logs = await PaymentLog.find({ order: req.params.id }).sort({ createdAt: -1 }).lean();
  res.json({ success: true, data: { logs } });
});

/**
 * @desc    Razorpay webhook
 * @route   POST /api/orders/webhook/razorpay
 * @access  Public (authenticated by Razorpay's HMAC signature)
 *
 * NOTE: this route is mounted with a raw body parser in app.js. The signature
 * is computed over the exact bytes Razorpay sent — re-serialising a parsed
 * object would change key order/whitespace and break verification.
 */
export const razorpayWebhook = asyncHandler(async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));

  if (!config.razorpay.webhookSecret) {
    throw new ApiError(503, 'Webhook secret not configured.');
  }

  const expectedSignature = crypto
    .createHmac('sha256', config.razorpay.webhookSecret)
    .update(rawBody)
    .digest('hex');

  if (signature !== expectedSignature) {
    throw new ApiError(400, 'Invalid webhook signature.');
  }

  const body = JSON.parse(rawBody.toString('utf8'));
  const { event, payload } = body;
  const entity = payload?.payment?.entity || payload?.refund?.entity || {};
  const razorpayOrderId = entity.order_id;

  const order = razorpayOrderId
    ? await Order.findOne({ 'paymentResult.razorpayOrderId': razorpayOrderId }).populate('user', 'firstName lastName email')
    : null;

  const logBase = {
    order: order?._id,
    orderNumber: order?.orderNumber,
    user: order?.user?._id,
    source: 'webhook',
    event,
    razorpayOrderId,
    razorpayPaymentId: entity.id,
    amount: entity.amount ? entity.amount / 100 : undefined,
    method: entity.method,
    raw: body,
  };

  if (event === 'payment.captured' && order) {
    if (!order.isPaid) {
      order.isPaid = true;
      order.paidAt = new Date();
      order.status = 'confirmed';
      order.paymentResult.status = 'paid';
      order.paymentResult.razorpayPaymentId = entity.id;
      order.paymentResult.paidAt = new Date();
      order.statusHistory.push({ status: 'confirmed', note: 'Payment captured (webhook)' });
      await order.save();
      if (order.user?.email) sendOrderConfirmation(order.user, order);
    }
    PaymentLog.record({ ...logBase, status: 'paid' });
  } else if (event === 'payment.failed' && order) {
    order.paymentResult.status = 'failed';
    order.statusHistory.push({
      status: order.status,
      note: `Payment failed: ${entity.error_description || entity.error_code || 'unknown reason'}`,
    });
    await order.save();
    PaymentLog.record({
      ...logBase,
      status: 'failed',
      errorCode: entity.error_code,
      errorDescription: entity.error_description,
    });
  } else if (event === 'refund.processed' && order) {
    order.status = 'refunded';
    order.statusHistory.push({ status: 'refunded', note: 'Refund processed (webhook)' });
    await order.save();
    PaymentLog.record({ ...logBase, status: 'refunded' });
  } else {
    PaymentLog.record({ ...logBase, status: 'attempted' });
  }

  // Always 200 — a non-2xx makes Razorpay retry the same event indefinitely.
  res.json({ success: true });
});
