import app from './app.js';
import config from './config/index.js';
import connectDB from './config/db.js';

/**
 * Server Entry Point
 * Connects to MongoDB then starts the Express server
 */
const startServer = async () => {
  // Connect to MongoDB
  await connectDB();

  // Start Express server
  const server = app.listen(config.port, () => {
    console.log(`
    ╔═══════════════════════════════════════════════╗
    ║                                               ║
    ║   🐾  AniLiving API Server                    ║
    ║                                               ║
    ║   Environment : ${config.env.padEnd(28)}║
    ║   Port        : ${String(config.port).padEnd(28)}║
    ║   URL         : http://localhost:${String(config.port).padEnd(13)}║
    ║                                               ║
    ╚═══════════════════════════════════════════════╝
    `);
  });

  // Graceful shutdown
  const shutdown = (signal) => {
    console.log(`\n${signal} received. Shutting down gracefully...`);
    server.close(() => {
      console.log('Server closed.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (err) => {
    console.error('❌ Unhandled Promise Rejection:', err.message);
    server.close(() => process.exit(1));
  });
};

startServer();
