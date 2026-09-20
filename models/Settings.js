import mongoose from 'mongoose';

/**
 * Settings Model
 * Singleton pattern — only one settings document exists.
 * Controls site-wide configuration from the admin panel.
 */
const settingsSchema = new mongoose.Schema({
  siteName: {
    type: String,
    default: 'AniLiving',
  },
  tagline: {
    type: String,
    default: 'Everything Your Pet Deserves.',
  },
  logo: {
    type: String,
    default: '',
  },
  favicon: {
    type: String,
    default: '',
  },
  contactEmail: {
    type: String,
    default: '',
  },
  contactPhone: {
    type: String,
    default: '',
  },
  address: {
    type: String,
    default: '',
  },
  socialLinks: {
    facebook: { type: String, default: '' },
    instagram: { type: String, default: '' },
    twitter: { type: String, default: '' },
    youtube: { type: String, default: '' },
    whatsapp: { type: String, default: '' },
  },

  // E-commerce settings
  codEnabled: {
    type: Boolean,
    default: true,
  },
  shippingCharge: {
    type: Number,
    default: 0,
  },
  freeShippingThreshold: {
    type: Number,
    default: 0, // Free shipping on all orders
  },
  taxRate: {
    type: Number,
    default: 18, // GST percentage
  },
  currency: {
    type: String,
    default: 'INR',
  },
  currencySymbol: {
    type: String,
    default: '₹',
  },

  // SEO
  seo: {
    title: { type: String, default: 'AniLiving - Premium Pet Supplies' },
    description: { type: String, default: 'Shop premium pet supplies at AniLiving. Everything your pet deserves.' },
    keywords: { type: String, default: 'pet supplies, dog food, cat food, pet accessories, aniliving' },
  },

  // Order settings
  minOrderValue: {
    type: Number,
    default: 0,
  },
  autoConfirmOrders: {
    type: Boolean,
    default: true,
  },
  reviewAutoApprove: {
    type: Boolean,
    default: true,
  },
}, {
  timestamps: true,
});

// Ensure only one settings document
settingsSchema.statics.getSettings = async function () {
  let settings = await this.findOne();
  if (!settings) {
    settings = await this.create({});
  }
  return settings;
};

const Settings = mongoose.model('Settings', settingsSchema);
export default Settings;
