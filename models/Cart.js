import mongoose from 'mongoose';

/**
 * Cart Model
 * Supports both guest and logged-in user carts with coupon application
 */
const cartItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true,
  },
  variantId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null,
  },
  variant: {
    type: Map,
    of: String,
    default: new Map(),
  },
  quantity: {
    type: Number,
    required: true,
    min: 1,
    default: 1,
  },
  price: {
    type: Number,
    required: true,
    min: 0,
  },
  savedForLater: {
    type: Boolean,
    default: false,
  },
}, { _id: true });

const cartSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
  },
  items: [cartItemSchema],
  coupon: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Coupon',
  },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Virtual: total items (excluding saved for later)
cartSchema.virtual('totalItems').get(function () {
  return this.items
    .filter((item) => !item.savedForLater)
    .reduce((sum, item) => sum + item.quantity, 0);
});

// Virtual: subtotal
cartSchema.virtual('subtotal').get(function () {
  return this.items
    .filter((item) => !item.savedForLater)
    .reduce((sum, item) => sum + (item.price * item.quantity), 0);
});

// Index

const Cart = mongoose.model('Cart', cartSchema);
export default Cart;
