import mongoose from 'mongoose';

/**
 * Banner Model
 * Homepage banner management — admin can create, sort, and toggle banners
 */
const bannerSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Banner title is required'],
    trim: true,
    maxlength: 200,
  },
  subtitle: {
    type: String,
    trim: true,
    maxlength: 300,
  },
  image: {
    type: String, // URL
    required: [true, 'Banner image URL is required'],
  },
  mobileImage: {
    type: String, // URL — separate image for mobile
  },
  link: {
    type: String,
    trim: true,
  },
  buttonText: {
    type: String,
    trim: true,
    default: 'Shop Now',
  },
  sortOrder: {
    type: Number,
    default: 0,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  startDate: {
    type: Date,
  },
  endDate: {
    type: Date,
  },
}, {
  timestamps: true,
});

// Index
bannerSchema.index({ isActive: 1, sortOrder: 1 });

const Banner = mongoose.model('Banner', bannerSchema);
export default Banner;
