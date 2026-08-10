import mongoose from 'mongoose';

/**
 * Category Model
 * Supports unlimited categories and subcategories via self-referencing parent field.
 * Fully dynamic — no hardcoded pet types.
 */
const categorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Category name is required'],
    trim: true,
    maxlength: 100,
  },
  slug: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  description: {
    type: String,
    trim: true,
    maxlength: 500,
  },
  image: {
    type: String, // URL to category image
    default: '',
  },
  parent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    default: null, // null = top-level category
  },
  seo: {
    title: { type: String, trim: true, maxlength: 70 },
    description: { type: String, trim: true, maxlength: 160 },
    keywords: { type: String, trim: true },
  },
  sortOrder: {
    type: Number,
    default: 0,
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

// Virtual: subcategories (populate children)
categorySchema.virtual('subcategories', {
  ref: 'Category',
  localField: '_id',
  foreignField: 'parent',
});

// Virtual: product count
categorySchema.virtual('productCount', {
  ref: 'Product',
  localField: '_id',
  foreignField: 'category',
  count: true,
});

// Indexes
categorySchema.index({ parent: 1 });
categorySchema.index({ isActive: 1, sortOrder: 1 });

const Category = mongoose.model('Category', categorySchema);
export default Category;
