import mongoose from 'mongoose';

/**
 * Coupon Model
 * Supports percentage and fixed discount types with usage limits and expiry
 */
const couponSchema = new mongoose.Schema({
  code: {
    type: String,
    required: [true, 'Coupon code is required'],
    unique: true,
    uppercase: true,
    trim: true,
  },
  type: {
    type: String,
    enum: ['percentage', 'fixed'],
    required: [true, 'Coupon type is required'],
  },
  value: {
    type: Number,
    required: [true, 'Coupon value is required'],
    min: 0,
  },
  minOrderValue: {
    type: Number,
    default: 0,
    min: 0,
  },
  maxDiscount: {
    type: Number, // Cap for percentage discounts
    min: 0,
  },
  expiryDate: {
    type: Date,
    required: [true, 'Coupon expiry date is required'],
  },
  usageLimit: {
    type: Number, // Total uses allowed
    default: null, // null = unlimited
  },
  usageLimitPerUser: {
    type: Number,
    default: 1,
  },
  usedCount: {
    type: Number,
    default: 0,
  },
  usedBy: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    usedAt: { type: Date, default: Date.now },
  }],
  isActive: {
    type: Boolean,
    default: true,
  },
  description: {
    type: String,
    trim: true,
  },
}, {
  timestamps: true,
});

// Index
couponSchema.index({ isActive: 1, expiryDate: 1 });

// Virtual: is expired
couponSchema.virtual('isExpired').get(function () {
  return new Date() > this.expiryDate;
});

// Virtual: is usage exhausted
couponSchema.virtual('isExhausted').get(function () {
  if (this.usageLimit === null) return false;
  return this.usedCount >= this.usageLimit;
});

// Method: check if valid
couponSchema.methods.isValid = function (orderTotal, userId) {
  if (!this.isActive) return { valid: false, message: 'Coupon is not active' };
  if (this.isExpired) return { valid: false, message: 'Coupon has expired' };
  if (this.isExhausted) return { valid: false, message: 'Coupon usage limit reached' };
  if (orderTotal < this.minOrderValue) {
    return { valid: false, message: `Minimum order value is ₹${this.minOrderValue}` };
  }
  // Check per-user usage
  if (userId) {
    const userUsage = this.usedBy.filter((u) => u.user.toString() === userId.toString()).length;
    if (userUsage >= this.usageLimitPerUser) {
      return { valid: false, message: 'You have already used this coupon' };
    }
  }
  return { valid: true };
};

// Method: calculate discount
couponSchema.methods.calculateDiscount = function (orderTotal) {
  let discount = 0;
  if (this.type === 'percentage') {
    discount = (orderTotal * this.value) / 100;
    if (this.maxDiscount && discount > this.maxDiscount) {
      discount = this.maxDiscount;
    }
  } else {
    discount = this.value;
  }
  return Math.min(discount, orderTotal); // Can't discount more than total
};

const Coupon = mongoose.model('Coupon', couponSchema);
export default Coupon;
