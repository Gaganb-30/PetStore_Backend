import Cart from '../models/Cart.js';
import Product from '../models/Product.js';
import Coupon from '../models/Coupon.js';
import { asyncHandler } from '../utils/helpers.js';
import { ApiError } from '../middleware/errorHandler.js';

const PRODUCT_FIELDS = 'name slug thumbnail images price mrp discount stock availability variants isActive';

/**
 * Turn a cart document into the payload the client consumes.
 *
 * The stored `coupon` is only a reference; the client needs the code *and* the
 * money it actually saves, recomputed against the current subtotal — a coupon
 * applied last week may now clear a different discount, or none at all.
 */
const serializeCart = async (cart) => {
  await cart.populate({ path: 'items.product', select: PRODUCT_FIELDS });

  const plain = cart.toJSON();

  const subtotal = cart.items
    .filter((item) => !item.savedForLater)
    .reduce((sum, item) => sum + item.price * item.quantity, 0);

  plain.subtotal = Math.round(subtotal * 100) / 100;
  plain.coupon = null;

  if (cart.coupon) {
    const coupon = await Coupon.findById(cart.coupon);
    const validation = coupon?.isValid(subtotal, cart.user);
    if (coupon && validation?.valid) {
      plain.coupon = {
        _id: coupon._id,
        code: coupon.code,
        type: coupon.type,
        value: coupon.value,
        discount: Math.round(coupon.calculateDiscount(subtotal) * 100) / 100,
      };
    } else {
      // The coupon has expired or the basket no longer qualifies — drop it so
      // checkout never quotes a discount the server would refuse.
      cart.coupon = undefined;
      await cart.save();
    }
  }

  return plain;
};

/**
 * @desc    Get user cart
 * @route   GET /api/cart
 * @access  Private
 */
export const getCart = asyncHandler(async (req, res) => {
  let cart = await Cart.findOne({ user: req.user._id });
  if (!cart) cart = await Cart.create({ user: req.user._id, items: [] });

  res.json({ success: true, data: { cart: await serializeCart(cart) } });
});

/**
 * @desc    Add item to cart
 * @route   POST /api/cart
 * @access  Private
 */
export const addToCart = asyncHandler(async (req, res) => {
  const { productId, quantity = 1, variantId, variant } = req.body;

  const qty = Math.max(1, parseInt(quantity, 10) || 1);

  const product = await Product.findById(productId);
  if (!product) throw new ApiError(404, 'Product not found.');
  if (!product.isActive) throw new ApiError(400, 'This product is no longer available.');
  if (['out_of_stock', 'discontinued'].includes(product.availability)) {
    throw new ApiError(400, `"${product.name}" is out of stock.`);
  }

  // Price and stock always come from the chosen variant when there is one —
  // a colour/size choice can carry its own price and its own inventory.
  let price = product.price;
  let available = product.stock;

  if (variantId) {
    const productVariant = product.variants.id(variantId);
    if (!productVariant || productVariant.isActive === false) {
      throw new ApiError(400, 'The selected option is no longer available.');
    }
    price = productVariant.price;
    available = productVariant.stock;
  }

  let cart = await Cart.findOne({ user: req.user._id });
  if (!cart) {
    cart = new Cart({ user: req.user._id, items: [] });
  }

  // Check if item already exists
  const existingIndex = cart.items.findIndex(
    (item) => item.product.toString() === productId &&
    (variantId ? item.variantId?.toString() === variantId : !item.variantId)
  );

  // Validate against the *resulting* quantity, not just the increment
  const resultingQty = existingIndex > -1 && !cart.items[existingIndex].savedForLater
    ? cart.items[existingIndex].quantity + qty
    : qty;
  if (available < resultingQty) {
    throw new ApiError(400, available > 0
      ? `Only ${available} unit(s) available.`
      : 'This item is out of stock.');
  }

  if (existingIndex > -1) {
    cart.items[existingIndex].quantity = resultingQty;
    cart.items[existingIndex].price = price;
    cart.items[existingIndex].savedForLater = false;
  } else {
    cart.items.push({
      product: productId,
      variantId,
      variant: variant || new Map(),
      quantity: qty,
      price,
    });
  }

  await cart.save();

  // Populate and return
  res.json({ success: true, message: 'Item added to cart.', data: { cart: await serializeCart(cart) } });
});

/**
 * @desc    Update cart item quantity
 * @route   PUT /api/cart/:itemId
 * @access  Private
 */
export const updateCartItem = asyncHandler(async (req, res) => {
  const { quantity } = req.body;
  if (!quantity || quantity < 1) {
    throw new ApiError(400, 'Quantity must be at least 1.');
  }

  const cart = await Cart.findOne({ user: req.user._id });
  if (!cart) throw new ApiError(404, 'Cart not found.');

  const item = cart.items.id(req.params.itemId);
  if (!item) throw new ApiError(404, 'Item not found in cart.');

  // Check stock against the variant when the line has one
  const product = await Product.findById(item.product);
  if (!product) throw new ApiError(404, 'Product no longer exists.');

  const available = item.variantId
    ? (product.variants.id(item.variantId)?.stock ?? 0)
    : product.stock;

  if (available < quantity) {
    throw new ApiError(400, available > 0
      ? `Only ${available} unit(s) available.`
      : 'This item is out of stock.');
  }

  item.quantity = quantity;
  await cart.save();

  res.json({ success: true, message: 'Cart updated.', data: { cart: await serializeCart(cart) } });
});

/**
 * @desc    Remove item from cart
 * @route   DELETE /api/cart/:itemId
 * @access  Private
 */
export const removeFromCart = asyncHandler(async (req, res) => {
  const cart = await Cart.findOne({ user: req.user._id });
  if (!cart) throw new ApiError(404, 'Cart not found.');

  const item = cart.items.id(req.params.itemId);
  if (!item) throw new ApiError(404, 'Item not found in cart.');

  item.deleteOne();
  await cart.save();

  res.json({ success: true, message: 'Item removed.', data: { cart: await serializeCart(cart) } });
});

/**
 * @desc    Clear cart
 * @route   DELETE /api/cart
 * @access  Private
 */
export const clearCart = asyncHandler(async (req, res) => {
  const cart = await Cart.findOne({ user: req.user._id });
  if (cart) {
    cart.items = [];
    cart.coupon = undefined;
    await cart.save();
  }
  res.json({ success: true, message: 'Cart cleared.' });
});

/**
 * @desc    Save item for later / move back to cart
 * @route   PATCH /api/cart/:itemId/save-for-later
 * @access  Private
 */
export const toggleSaveForLater = asyncHandler(async (req, res) => {
  const cart = await Cart.findOne({ user: req.user._id });
  if (!cart) throw new ApiError(404, 'Cart not found.');

  const item = cart.items.id(req.params.itemId);
  if (!item) throw new ApiError(404, 'Item not found in cart.');

  item.savedForLater = !item.savedForLater;
  await cart.save();

  res.json({
    success: true,
    message: item.savedForLater ? 'Item saved for later.' : 'Item moved to cart.',
    data: { cart: await serializeCart(cart) },
  });
});

/**
 * @desc    Apply coupon to cart
 * @route   POST /api/cart/apply-coupon
 * @access  Private
 */
export const applyCoupon = asyncHandler(async (req, res) => {
  const { code } = req.body;

  const cart = await Cart.findOne({ user: req.user._id });
  if (!cart) throw new ApiError(404, 'Cart not found.');
  if (!code?.trim()) throw new ApiError(400, 'Please enter a coupon code.');

  const coupon = await Coupon.findOne({ code: code.trim().toUpperCase() });
  if (!coupon) throw new ApiError(404, 'That coupon code is not valid.');

  const subtotal = cart.items
    .filter((item) => !item.savedForLater)
    .reduce((sum, item) => sum + item.price * item.quantity, 0);

  const validation = coupon.isValid(subtotal, req.user._id);
  if (!validation.valid) {
    throw new ApiError(400, validation.message);
  }

  const discount = coupon.calculateDiscount(subtotal);

  cart.coupon = coupon._id;
  await cart.save();

  res.json({
    success: true,
    message: `Coupon applied — you save ₹${discount.toFixed(2)}.`,
    data: { discount, couponCode: coupon.code, cart: await serializeCart(cart) },
  });
});

/**
 * @desc    Remove coupon from cart
 * @route   DELETE /api/cart/remove-coupon
 * @access  Private
 */
export const removeCoupon = asyncHandler(async (req, res) => {
  const cart = await Cart.findOne({ user: req.user._id });
  if (!cart) throw new ApiError(404, 'Cart not found.');

  cart.coupon = undefined;
  await cart.save();

  res.json({ success: true, message: 'Coupon removed.', data: { cart: await serializeCart(cart) } });
});
