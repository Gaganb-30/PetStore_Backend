import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

/**
 * User Model
 * Supports customers and admins with address management, wishlist, and refresh tokens
 */
const addressSchema = new mongoose.Schema({
  fullName: { type: String, required: true, trim: true },
  phone: { type: String, required: true, trim: true },
  addressLine1: { type: String, required: true, trim: true },
  addressLine2: { type: String, trim: true },
  city: { type: String, required: true, trim: true },
  state: { type: String, required: true, trim: true },
  pincode: { type: String, required: true, trim: true },
  country: { type: String, default: 'India', trim: true },
  isDefault: { type: Boolean, default: false },
  type: { type: String, enum: ['home', 'work', 'other'], default: 'home' },
}, { _id: true });

const userSchema = new mongoose.Schema({
  firstName: {
    type: String,
    required: [true, 'First name is required'],
    trim: true,
    maxlength: 50,
  },
  lastName: {
    type: String,
    required: [true, 'Last name is required'],
    trim: true,
    maxlength: 50,
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email'],
  },
  password: {
    type: String,
    // Only local accounts carry a password. Google accounts authenticate via
    // Google's ID token, so requiring one here would block OAuth sign-up.
    required: [
      function () { return this.authProvider === 'local'; },
      'Password is required',
    ],
    minlength: [8, 'Password must be at least 8 characters'],
    select: false, // Don't return password by default
  },

  // ---------------------------------------------------------------------
  // Authentication provider
  // ---------------------------------------------------------------------
  authProvider: {
    type: String,
    enum: ['local', 'google'],
    default: 'local',
  },
  googleId: {
    type: String,
    default: undefined,
  },
  isEmailVerified: {
    type: Boolean,
    default: false,
  },
  phone: {
    type: String,
    trim: true,
  },
  avatar: {
    type: String,
    default: '',
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user',
  },
  addresses: [addressSchema],
  wishlist: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
  }],
  refreshTokens: [{
    token: String,
    createdAt: { type: Date, default: Date.now, expires: '7d' },
  }],
  isActive: {
    type: Boolean,
    default: true,
  },
  passwordResetToken: String,
  passwordResetExpires: Date,
  lastLogin: Date,
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Virtual: full name
userSchema.virtual('fullName').get(function () {
  return `${this.firstName} ${this.lastName}`;
});

// Index for faster queries
userSchema.index({ role: 1 });
// Sparse so that the many local accounts (no googleId) don't collide on null
userSchema.index({ googleId: 1 }, { unique: true, sparse: true });

// Pre-save: hash password
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Method: compare password. Google-only accounts have no password hash, so
// any comparison against them must fail rather than throw.
userSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.password) return false;
  return bcrypt.compare(candidatePassword, this.password);
};

// Method: does this account have a usable password (false for Google-only users)
userSchema.methods.hasPassword = function () {
  return Boolean(this.password) || this.authProvider === 'local';
};

// Method: get default address
userSchema.methods.getDefaultAddress = function () {
  return this.addresses.find((addr) => addr.isDefault) || this.addresses[0];
};

const User = mongoose.model('User', userSchema);
export default User;
