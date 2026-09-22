import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

/**
 * User Model
 * Supports customers (email-OTP) and admins (email+password) with address
 * management, wishlist, and refresh tokens.
 *
 * Auth flow (email-OTP):
 *   - email  → required + unique for all accounts
 *   - phone  → optional (kept for delivery address contact)
 *   - authProvider 'email' is the default for storefront users
 *   - password is only required when authProvider === 'local' (admin path)
 *   - otpLastSentAt tracks when the last OTP was sent so the server can
 *     enforce the resend timeout independently of the client.
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
    default: '',
    trim: true,
    maxlength: 50,
  },

  // ---------------------------------------------------------------------
  // Contact — email is the primary identifier for storefront (email-OTP)
  // users. phone is optional (used for delivery addresses).
  // ---------------------------------------------------------------------
  email: {
    type: String,
    unique: true,
    sparse: true,           // allows multiple documents with no email
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email'],
  },
  phone: {
    type: String,
    trim: true,
    unique: true,
    sparse: true,           // admin/google accounts may not have a phone yet
  },

  password: {
    type: String,
    // Only local (admin) accounts carry a password hash.
    required: [
      function () { return this.authProvider === 'local'; },
      'Password is required',
    ],
    minlength: [8, 'Password must be at least 8 characters'],
    select: false,
  },

  // ---------------------------------------------------------------------
  // Authentication provider
  // ---------------------------------------------------------------------
  authProvider: {
    type: String,
    enum: ['email', 'phone', 'local', 'google'],
    default: 'email',
  },
  googleId: {
    type: String,
    default: undefined,
  },
  isEmailVerified: {
    type: Boolean,
    default: false,
  },
  isPhoneVerified: {
    type: Boolean,
    default: false,
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

  // ---------------------------------------------------------------------
  // OTP resend throttle
  // Stores the timestamp of the last successful OTP send so the server can
  // reject resend requests that arrive before the configured timeout.
  // ---------------------------------------------------------------------
  otpLastSentAt: {
    type: Date,
    default: null,
  },

  addresses: [addressSchema],
  wishlist: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
  }],
  refreshTokens: [{
    token: String,
    // NOTE: Do NOT add `expires` here — MongoDB TTL indexes only work on
    // top-level document fields, not on subdocument array fields.
    // Using `expires` on a nested field deletes the entire parent User document,
    // not just the array element. Token lifetime is enforced by the JWT itself
    // (jwtRefreshExpire) and stale tokens are pruned on each login/refresh.
    createdAt: { type: Date, default: Date.now },
  }],
  isActive: {
    type: Boolean,
    default: true,
  },

  // Kept commented — not needed for phone-OTP users; retained for admin path
  // passwordResetToken: String,
  // passwordResetExpires: Date,

  lastLogin: Date,
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Virtual: full name
userSchema.virtual('fullName').get(function () {
  return `${this.firstName} ${this.lastName}`.trim();
});

// Indexes
userSchema.index({ role: 1 });
// Sparse so that the many phone accounts (no googleId) don't collide on null
userSchema.index({ googleId: 1 }, { unique: true, sparse: true });

// Pre-save: hash password (only for local/admin accounts)
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Method: compare password. Non-local accounts have no password hash.
userSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.password) return false;
  return bcrypt.compare(candidatePassword, this.password);
};

// Method: does this account have a usable password (false for phone/Google users)
userSchema.methods.hasPassword = function () {
  return Boolean(this.password) || this.authProvider === 'local';
};

// Method: get default address
userSchema.methods.getDefaultAddress = function () {
  return this.addresses.find((addr) => addr.isDefault) || this.addresses[0];
};

const User = mongoose.model('User', userSchema);
export default User;
