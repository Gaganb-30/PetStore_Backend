import mongoose from 'mongoose';
import crypto from 'crypto';

/**
 * Order Model
 * Complete order lifecycle with Razorpay integration, status tracking, and invoice support
 */
const orderItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true,
  },
  name: { type: String, required: true },
  thumbnail: { type: String },
  variant: {
    type: Map,
    of: String,
    default: new Map(),
    // e.g. { "Color": "Red", "Size": "Large" }
  },
  variantId: { type: mongoose.Schema.Types.ObjectId },
  sku: { type: String },
  price: { type: Number, required: true, min: 0 },
  quantity: { type: Number, required: true, min: 1 },
}, { _id: true });

const statusHistorySchema = new mongoose.Schema({
  status: { type: String, required: true },
  note: { type: String },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  timestamp: { type: Date, default: Date.now },
}, { _id: true });

const orderSchema = new mongoose.Schema({
  // Order number — human-readable ID (e.g. ANI-20260713-0001)
  orderNumber: {
    type: String,
    required: true,
    unique: true,
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  items: [orderItemSchema],

  // Shipping address snapshot (so it persists even if user changes address later)
  shippingAddress: {
    fullName: { type: String, required: true },
    phone: { type: String, required: true },
    addressLine1: { type: String, required: true },
    addressLine2: { type: String },
    city: { type: String, required: true },
    state: { type: String, required: true },
    pincode: { type: String, required: true },
    country: { type: String, default: 'India' },
  },

  // Payment
  paymentMethod: {
    type: String,
    enum: ['razorpay', 'cod'],
    required: true,
  },
  paymentResult: {
    razorpayOrderId: { type: String },
    razorpayPaymentId: { type: String },
    razorpaySignature: { type: String },
    status: { type: String },
    paidAt: { type: Date },
  },

  // Pricing breakdown
  itemsPrice: { type: Number, required: true, min: 0 },
  taxPrice: { type: Number, default: 0, min: 0 },
  shippingPrice: { type: Number, default: 0, min: 0 },
  discountAmount: { type: Number, default: 0, min: 0 },
  totalPrice: { type: Number, required: true, min: 0 },

  // Coupon applied
  coupon: {
    code: { type: String },
    discount: { type: Number },
  },

  // Order status
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'processing', 'shipped', 'out_for_delivery', 'delivered', 'cancelled', 'returned', 'refunded'],
    default: 'pending',
  },
  statusHistory: [statusHistorySchema],

  // Tracking — admin fills these in; the customer sees them on order tracking
  courierName: { type: String, trim: true },
  trackingNumber: { type: String, trim: true },
  trackingUrl: { type: String, trim: true },
  estimatedDelivery: { type: Date },

  // Flags
  isPaid: { type: Boolean, default: false },
  paidAt: { type: Date },
  isDelivered: { type: Boolean, default: false },
  deliveredAt: { type: Date },
  isCancelled: { type: Boolean, default: false },
  cancelledAt: { type: Date },
  cancellationReason: { type: String },

  // Notes
  customerNote: { type: String, maxlength: 500 },
  adminNote: { type: String, maxlength: 1000 },

}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Indexes
orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ status: 1 });
orderSchema.index({ 'paymentResult.razorpayOrderId': 1 });
orderSchema.index({ createdAt: -1 });

/**
 * Pre-validate: generate a human-readable order number.
 *
 * Runs on `validate` (not `save`) because `orderNumber` is required — a
 * pre-save hook fires too late and the document would fail validation first.
 * A counting query alone races under concurrent checkouts, so the daily
 * sequence is combined with a short random suffix to guarantee uniqueness.
 */
orderSchema.pre('validate', async function (next) {
  if (this.orderNumber) return next();
  try {
    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
    const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const count = await mongoose.model('Order').countDocuments({ createdAt: { $gte: startOfDay } });
    const suffix = crypto.randomBytes(2).toString('hex').toUpperCase();
    this.orderNumber = `ANI-${dateStr}-${String(count + 1).padStart(4, '0')}${suffix}`;
    next();
  } catch (err) {
    next(err);
  }
});

const Order = mongoose.model('Order', orderSchema);
export default Order;
