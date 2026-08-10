/**
 * Bootstrap an administrator account.
 *
 *   npm run create-admin
 *
 * Reads ADMIN_EMAIL / ADMIN_PASSWORD (and optionally ADMIN_FIRST_NAME,
 * ADMIN_LAST_NAME) from .env. Safe to run repeatedly: if the account already
 * exists it is promoted to admin and, when a password is supplied, reset.
 */
import mongoose from 'mongoose';
import config from '../config/index.js';
import User from '../models/User.js';

const run = async () => {
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.error('❌ Set ADMIN_EMAIL and ADMIN_PASSWORD in server/.env first.');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('❌ ADMIN_PASSWORD must be at least 8 characters.');
    process.exit(1);
  }

  await mongoose.connect(config.mongoUri);
  console.log('✅ Connected to MongoDB');

  let user = await User.findOne({ email }).select('+password');

  if (user) {
    user.role = 'admin';
    user.password = password;   // re-hashed by the pre-save hook
    user.isActive = true;
    user.refreshTokens = [];    // force a fresh login everywhere
    await user.save();
    console.log(`✅ Existing account promoted to admin: ${email}`);
  } else {
    user = await User.create({
      firstName: process.env.ADMIN_FIRST_NAME || 'Store',
      lastName: process.env.ADMIN_LAST_NAME || 'Admin',
      email,
      password,
      role: 'admin',
      authProvider: 'local',
      isEmailVerified: true,
    });
    console.log(`✅ Admin account created: ${email}`);
  }

  console.log('   Sign in at /login, then open /admin.');
  await mongoose.disconnect();
  process.exit(0);
};

run().catch((err) => {
  console.error('❌ Failed to create admin:', err.message);
  process.exit(1);
});
