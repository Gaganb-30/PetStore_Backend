import mongoose from 'mongoose';
import Review from '../models/Review.js';
import Order from '../models/Order.js';
import Settings from '../models/Settings.js';
import { asyncHandler, paginate } from '../utils/helpers.js';
import { ApiError } from '../middleware/errorHandler.js';

/**
 * @desc    Get reviews for a product
 * @route   GET /api/reviews/product/:productId
 * @access  Public
 */
export const getProductReviews = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);

  const filter = { product: req.params.productId, isApproved: true };
  const sort = req.query.sort === 'helpful' ? { helpfulCount: -1 } : { createdAt: -1 };

  const [reviews, total] = await Promise.all([
    Review.find(filter)
      .populate('user', 'firstName lastName avatar')
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    Review.countDocuments(filter),
  ]);

  // Rating distribution.
  // NOTE: $match does not cast types the way find() does, so the id must be a
  // real ObjectId here — passing the raw string silently matches nothing.
  const distribution = await Review.aggregate([
    { $match: { product: new mongoose.Types.ObjectId(String(req.params.productId)), isApproved: true } },
    { $group: { _id: '$rating', count: { $sum: 1 } } },
    { $sort: { _id: -1 } },
  ]);

  res.json({
    success: true,
    data: {
      reviews,
      ratingDistribution: distribution,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    },
  });
});

/**
 * @desc    Create review
 * @route   POST /api/reviews
 * @access  Private
 */
export const createReview = asyncHandler(async (req, res) => {
  // Accept either key — `productId` is the documented field, `product` is what
  // a caller mirroring the schema would naturally send.
  const { productId, product, rating, title, comment, images } = req.body;
  const targetProduct = productId || product;

  if (!targetProduct || !mongoose.isValidObjectId(String(targetProduct))) {
    throw new ApiError(400, 'A valid product is required.');
  }
  if (!rating || Number(rating) < 1 || Number(rating) > 5) {
    throw new ApiError(400, 'Please give a rating between 1 and 5.');
  }
  if (!comment || String(comment).trim().length < 10) {
    throw new ApiError(400, 'Please write at least 10 characters.');
  }

  // Check if already reviewed
  const existing = await Review.findOne({ user: req.user._id, product: targetProduct });
  if (existing) {
    throw new ApiError(400, 'You have already reviewed this product.');
  }

  // Verified-purchase badge: the reviewer must have actually received the item
  const hasPurchased = await Order.findOne({
    user: req.user._id,
    'items.product': targetProduct,
    status: 'delivered',
  });

  // Stores that moderate reviews hold new ones back until an admin approves
  const settings = await Settings.getSettings();

  const review = await Review.create({
    user: req.user._id,
    product: targetProduct,
    rating: Number(rating),
    title,
    comment: String(comment).trim(),
    images: Array.isArray(images) ? images.filter(Boolean) : [],
    isVerifiedPurchase: Boolean(hasPurchased),
    isApproved: settings.reviewAutoApprove !== false,
  });

  await review.populate('user', 'firstName lastName avatar');

  res.status(201).json({
    success: true,
    message: review.isApproved
      ? 'Thanks for your review!'
      : 'Thanks! Your review will appear once it has been approved.',
    data: { review },
  });
});

/**
 * @desc    Admin reply to review
 * @route   PUT /api/reviews/:id/reply
 * @access  Private/Admin
 */
export const replyToReview = asyncHandler(async (req, res) => {
  const review = await Review.findByIdAndUpdate(
    req.params.id,
    { adminReply: { comment: req.body.comment, repliedAt: new Date() } },
    { new: true }
  );
  if (!review) throw new ApiError(404, 'Review not found.');
  res.json({ success: true, message: 'Reply posted.', data: { review } });
});

/**
 * @desc    Approve/reject review (Admin)
 * @route   PATCH /api/reviews/:id/approve
 * @access  Private/Admin
 */
export const toggleApproval = asyncHandler(async (req, res) => {
  const review = await Review.findById(req.params.id);
  if (!review) throw new ApiError(404, 'Review not found.');
  review.isApproved = !review.isApproved;
  await review.save();
  res.json({ success: true, message: `Review ${review.isApproved ? 'approved' : 'rejected'}.`, data: { review } });
});

/**
 * @desc    Delete review (Admin)
 * @route   DELETE /api/reviews/:id
 * @access  Private/Admin
 */
export const deleteReview = asyncHandler(async (req, res) => {
  const review = await Review.findByIdAndDelete(req.params.id);
  if (!review) throw new ApiError(404, 'Review not found.');
  res.json({ success: true, message: 'Review deleted.' });
});

/**
 * @desc    Get all reviews (Admin)
 * @route   GET /api/reviews
 * @access  Private/Admin
 */
export const getAllReviews = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);

  const filter = {};
  if (req.query.isApproved !== undefined) filter.isApproved = req.query.isApproved === 'true';
  if (req.query.product) filter.product = req.query.product;

  const [reviews, total] = await Promise.all([
    Review.find(filter)
      .populate('user', 'firstName lastName email')
      .populate('product', 'name slug thumbnail')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Review.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: {
      reviews,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    },
  });
});
