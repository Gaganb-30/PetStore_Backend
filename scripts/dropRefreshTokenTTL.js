/**
 * One-time script to drop the bad TTL index on refreshTokens.createdAt.
 *
 * BACKGROUND: The User model previously had `expires: '7d'` on the
 * `refreshTokens[].createdAt` subdocument field.  MongoDB TTL indexes only
 * work on top-level document fields, so instead of expiring individual array
 * elements it expired the ENTIRE User document 7 days after the first token
 * was created — silently wiping all users.
 *
 * Run once:
 *   node scripts/dropRefreshTokenTTL.js
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

const MONGO_URI = process.env.MONGO_URI;

async function run() {
  console.log('🔌 Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected.');

  const db = mongoose.connection.db;
  const collection = db.collection('users');

  // List all indexes so we can identify the TTL one
  const indexes = await collection.indexes();
  console.log('\n📋 Current indexes on "users" collection:');
  indexes.forEach((idx) => {
    console.log(`  - ${idx.name}:`, JSON.stringify(idx.key), idx.expireAfterSeconds != null ? `(TTL: ${idx.expireAfterSeconds}s)` : '');
  });

  // Find the bad TTL index (it will have expireAfterSeconds set and key on refreshTokens.createdAt)
  const badIndex = indexes.find(
    (idx) => idx.expireAfterSeconds != null && idx.key['refreshTokens.createdAt'] != null,
  );

  if (!badIndex) {
    console.log('\n✅ No bad TTL index found — nothing to drop. You are safe!');
  } else {
    console.log(`\n⚠️  Found bad TTL index: "${badIndex.name}" (expireAfterSeconds=${badIndex.expireAfterSeconds})`);
    await collection.dropIndex(badIndex.name);
    console.log(`✅ Dropped index "${badIndex.name}". Users will no longer be deleted automatically.`);
  }

  await mongoose.disconnect();
  console.log('\n✅ Done. Run `npm run create-admin` if you need to recreate the admin account.\n');
  process.exit(0);
}

run().catch((err) => {
  console.error('❌ Failed:', err.message);
  process.exit(1);
});
