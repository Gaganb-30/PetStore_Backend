import mongoose from 'mongoose';

/**
 * Product Model
 * Fully flexible schema — supports unlimited specifications, attributes, variants, and features.
 * No hardcoded fields for pet type, size, etc. Everything is dynamic via Maps and arrays.
 */

// Variant sub-schema: each variant has its own price, stock, SKU, images, and attribute combination
const variantSchema = new mongoose.Schema({
  attributeCombination: {
    type: Map,
    of: String,
    // e.g. { "Color": "Red", "Size": "Large" }
  },
  price: { type: Number, required: true, min: 0 },
  mrp: { type: Number, min: 0 },
  stock: { type: Number, required: true, default: 0, min: 0 },
  sku: { type: String, trim: true },
  images: [{ type: String }], // URLs
  isActive: { type: Boolean, default: true },
}, { _id: true });

const productSchema = new mongoose.Schema({
  // -----------------------------------------------------------------------
  // Basic Information
  // -----------------------------------------------------------------------
  name: {
    type: String,
    required: [true, 'Product name is required'],
    trim: true,
    maxlength: 200,
  },
  slug: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  shortDescription: {
    type: String,
    trim: true,
    maxlength: 300,
  },
  longDescription: {
    type: String,
    trim: true,
  },
  richDescription: {
    type: String, // HTML/Markdown content
  },
  brand: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Brand',
  },
  category: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    required: [true, 'Product category is required'],
  },
  subcategory: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
  },
  tags: [{
    type: String,
    trim: true,
  }],

  // -----------------------------------------------------------------------
  // Pricing
  // -----------------------------------------------------------------------
  price: {
    type: Number,
    required: [true, 'Product price is required'],
    min: 0,
  },
  mrp: {
    type: Number,
    min: 0,
  },
  discount: {
    type: Number, // percentage
    default: 0,
    min: 0,
    max: 100,
  },
  costPrice: {
    type: Number,
    min: 0,
  },
  tax: {
    type: Number, // percentage
    default: 0,
    min: 0,
  },

  // -----------------------------------------------------------------------
  // Inventory
  // -----------------------------------------------------------------------
  sku: {
    type: String,
    trim: true,
  },
  barcode: {
    type: String,
    trim: true,
  },
  stock: {
    type: Number,
    required: true,
    default: 0,
    min: 0,
  },
  availability: {
    type: String,
    enum: ['in_stock', 'out_of_stock', 'pre_order', 'discontinued'],
    default: 'in_stock',
  },
  lowStockAlert: {
    type: Number,
    default: 5,
  },

  // -----------------------------------------------------------------------
  // Media (URLs — no file upload, admin pastes URLs)
  // -----------------------------------------------------------------------
  thumbnail: {
    type: String,
    default: '',
  },
  images: [{
    type: String, // Array of image URLs
  }],
  videoUrl: {
    type: String,
    default: '',
  },

  // -----------------------------------------------------------------------
  // Specifications — fully dynamic key-value pairs via Map
  // e.g. { "Weight": "500g", "Material": "Nylon", "Color": "Black" }
  // -----------------------------------------------------------------------
  specifications: {
    type: Map,
    of: String,
    default: new Map(),
  },

  // -----------------------------------------------------------------------
  // Features — unlimited bullet points
  // -----------------------------------------------------------------------
  features: [{
    type: String,
    trim: true,
  }],

  // -----------------------------------------------------------------------
  // Attributes — dynamic attribute groups for filtering
  // e.g. [ { name: "Color", values: ["Red", "Blue"] }, { name: "Size", values: ["S", "M", "L"] } ]
  // -----------------------------------------------------------------------
  attributes: [{
    name: { type: String, trim: true },
    values: [{ type: String, trim: true }],
  }],

  // -----------------------------------------------------------------------
  // Variants
  // -----------------------------------------------------------------------
  variants: [variantSchema],

  // -----------------------------------------------------------------------
  // SEO
  // -----------------------------------------------------------------------
  seo: {
    title: { type: String, trim: true, maxlength: 70 },
    description: { type: String, trim: true, maxlength: 160 },
    keywords: { type: String, trim: true },
    canonicalUrl: { type: String, trim: true },
  },

  // -----------------------------------------------------------------------
  // Related products
  // -----------------------------------------------------------------------
  relatedProducts: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
  }],
  frequentlyBoughtTogether: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
  }],

  // -----------------------------------------------------------------------
  // Ratings (denormalized for performance)
  // -----------------------------------------------------------------------
  ratingsAverage: {
    type: Number,
    default: 0,
    min: 0,
    max: 5,
  },
  ratingsCount: {
    type: Number,
    default: 0,
  },

  // -----------------------------------------------------------------------
  // Flags
  // -----------------------------------------------------------------------
  isActive: { type: Boolean, default: true },
  isFeatured: { type: Boolean, default: false },
  isNewArrival: { type: Boolean, default: false },
  isBestSeller: { type: Boolean, default: false },
  isTrending: { type: Boolean, default: false },
  isFlashDeal: { type: Boolean, default: false },
  flashDealExpiry: { type: Date },

}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// -------------------------------------------------------------------------
// Indexes for efficient queries
// -------------------------------------------------------------------------
productSchema.index({ category: 1 });
productSchema.index({ subcategory: 1 });
productSchema.index({ brand: 1 });
productSchema.index({ price: 1 });
productSchema.index({ isActive: 1, isFeatured: 1 });
productSchema.index({ isActive: 1, isNewArrival: 1 });
productSchema.index({ isActive: 1, isBestSeller: 1 });
productSchema.index({ isActive: 1, isTrending: 1 });
productSchema.index({ isActive: 1, isFlashDeal: 1 });
productSchema.index({ tags: 1 });
productSchema.index({ createdAt: -1 });
productSchema.index({ ratingsAverage: -1 });

// Text index for search
productSchema.index({
  name: 'text',
  shortDescription: 'text',
  tags: 'text',
}, {
  weights: { name: 10, shortDescription: 5, tags: 3 },
});

// Virtual: calculated discount percentage
productSchema.virtual('discountPercentage').get(function () {
  if (this.mrp && this.mrp > this.price) {
    return Math.round(((this.mrp - this.price) / this.mrp) * 100);
  }
  return this.discount || 0;
});

// Virtual: in stock check
productSchema.virtual('inStock').get(function () {
  return this.stock > 0 && this.availability === 'in_stock';
});

// Virtual: low stock check
productSchema.virtual('isLowStock').get(function () {
  return this.stock > 0 && this.stock <= this.lowStockAlert;
});

const Product = mongoose.model('Product', productSchema);
export default Product;
