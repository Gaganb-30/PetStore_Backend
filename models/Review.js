import mongoose from 'mongoose';

/**
 * Review Model
 * Supports ratings, text reviews, customer images (via URL), verified purchase badge, and admin reply
 */
const reviewSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true,
  },
  rating: {
    type: Number,
    required: [true, 'Rating is required'],
    min: 1,
    max: 5,
  },
  title: {
    type: String,
    trim: true,
    maxlength: 200,
  },
  comment: {
    type: String,
    required: [true, 'Review comment is required'],
    trim: true,
    maxlength: 2000,
  },
  images: [{
    type: String, // URLs
  }],
  isVerifiedPurchase: {
    type: Boolean,
    default: false,
  },
  adminReply: {
    comment: { type: String, trim: true },
    repliedAt: { type: Date },
  },
  isApproved: {
    type: Boolean,
    default: true, // Auto-approve by default; admin can change this in settings
  },
  helpfulCount: {
    type: Number,
    default: 0,
  },
}, {
  timestamps: true,
});

// Each user can only review a product once
reviewSchema.index({ user: 1, product: 1 }, { unique: true });
reviewSchema.index({ product: 1, isApproved: 1, createdAt: -1 });

// Static method: calculate average rating for a product and update Product model
reviewSchema.statics.calcAverageRating = async function (productId) {
  const stats = await this.aggregate([
    { $match: { product: productId, isApproved: true } },
    {
      $group: {
        _id: '$product',
        avgRating: { $avg: '$rating' },
        count: { $sum: 1 },
      },
    },
  ]);

  if (stats.length > 0) {
    await mongoose.model('Product').findByIdAndUpdate(productId, {
      ratingsAverage: Math.round(stats[0].avgRating * 10) / 10,
      ratingsCount: stats[0].count,
    });
  } else {
    await mongoose.model('Product').findByIdAndUpdate(productId, {
      ratingsAverage: 0,
      ratingsCount: 0,
    });
  }
};

// Post save & remove: recalculate ratings
reviewSchema.post('save', function () {
  this.constructor.calcAverageRating(this.product);
});
reviewSchema.post('findOneAndDelete', function (doc) {
  if (doc) doc.constructor.calcAverageRating(doc.product);
});

const Review = mongoose.model('Review', reviewSchema);
export default Review;
