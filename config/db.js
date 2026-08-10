import mongoose from 'mongoose';
import config from './index.js';

/**
 * Connect to MongoDB with Mongoose
 * Includes connection pooling via Mongoose defaults and error logging
 */
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(config.mongoUri, {
      // Mongoose 8 uses the new connection string parser and unified topology by default
    });

    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);

    // Connection event listeners
    mongoose.connection.on('error', (err) => {
      console.error(`❌ MongoDB connection error: ${err.message}`);
    });

    mongoose.connection.on('disconnected', () => {
      console.warn('⚠️  MongoDB disconnected. Attempting to reconnect...');
    });

    mongoose.connection.on('reconnected', () => {
      console.log('✅ MongoDB reconnected');
    });

  } catch (error) {
    console.error(`❌ MongoDB connection failed: ${error.message}`);
    process.exit(1);
  }
};

export default connectDB;
