import mongoose from 'mongoose';

/**
 * PaymentLog Model
 *
 * An append-only audit trail of every payment event we see for an order —
 * checkout creation, client-side verification, webhook callbacks, failures and
 * refunds. Orders keep only the *current* payment state; this collection keeps
 * the history, which is what you actually need when a customer says "the money
 * left my account but the order says pending".
 */
const paymentLogSchema = new mongoose.Schema({
  order: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    index: true,
  },
  orderNumber: { type: String },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },

  // Where the event came from
  source: {
    type: String,
    enum: ['checkout', 'client_verification', 'webhook', 'admin', 'system'],
    required: true,
  },

  // Razorpay event / our own label, e.g. 'order.created', 'payment.captured'
  event: { type: String, required: true },

  status: {
    type: String,
    enum: ['created', 'attempted', 'paid', 'failed', 'refunded', 'cancelled'],
    required: true,
  },

  razorpayOrderId: { type: String, index: true },
  razorpayPaymentId: { type: String, index: true },
  razorpaySignature: { type: String },

  amount: { type: Number, min: 0 },   // in rupees
  currency: { type: String, default: 'INR' },
  method: { type: String },           // upi / card / netbanking / wallet …

  errorCode: { type: String },
  errorDescription: { type: String },

  // Raw provider payload, kept for dispute resolution
  raw: { type: mongoose.Schema.Types.Mixed },
}, {
  timestamps: true,
});

paymentLogSchema.index({ createdAt: -1 });

/**
 * Write a log line without ever breaking the caller. Payment logging is
 * diagnostic: if it fails we would rather lose the log than the payment.
 */
paymentLogSchema.statics.record = async function (entry) {
  try {
    return await this.create(entry);
  } catch (err) {
    console.error('PaymentLog write failed:', err.message);
    return null;
  }
};

const PaymentLog = mongoose.model('PaymentLog', paymentLogSchema);
export default PaymentLog;
