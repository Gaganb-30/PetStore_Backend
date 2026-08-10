import mongoose from 'mongoose';

/**
 * Brand Model
 * Dynamic brand management with logo, banner, description, and SEO
 */
const brandSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Brand name is required'],
    trim: true,
    unique: true,
    maxlength: 100,
  },
  slug: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  logo: {
    type: String, // URL
    default: '',
  },
  banner: {
    type: String, // URL
    default: '',
  },
  description: {
    type: String,
    trim: true,
    maxlength: 1000,
  },
  seo: {
    title: { type: String, trim: true, maxlength: 70 },
    description: { type: String, trim: true, maxlength: 160 },
    keywords: { type: String, trim: true },
  },
  isActive: {
    type: Boolean,
    default: true,
  },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Virtual: product count
brandSchema.virtual('productCount', {
  ref: 'Product',
  localField: '_id',
  foreignField: 'brand',
  count: true,
});

// Indexes
brandSchema.index({ isActive: 1 });

const Brand = mongoose.model('Brand', brandSchema);
export default Brand;
