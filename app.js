import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import config from './config/index.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import sanitize from './middleware/sanitize.js';

// Import routes
import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import productRoutes from './routes/productRoutes.js';
import categoryRoutes from './routes/categoryRoutes.js';
import brandRoutes from './routes/brandRoutes.js';
import orderRoutes from './routes/orderRoutes.js';
import cartRoutes from './routes/cartRoutes.js';
import reviewRoutes from './routes/reviewRoutes.js';
import couponRoutes from './routes/couponRoutes.js';
import bannerRoutes from './routes/bannerRoutes.js';
import settingsRoutes from './routes/settingsRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js';
import searchRoutes from './routes/searchRoutes.js';
import { getSitemap, getRobots } from './controllers/sitemapController.js';

const app = express();

// Behind Nginx in production — required for correct client IPs in rate limiting
// and for `secure` cookies to be recognised over a proxied TLS termination.
app.set('trust proxy', 1);
app.disable('x-powered-by');

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false, // Configured at the Nginx layer in production
}));

// CORS — allow the storefront origin(s) with credentials so the refresh-token
// cookie is sent. Multiple origins can be listed comma-separated in CLIENT_URL.
const allowedOrigins = String(config.clientUrl).split(',').map((o) => o.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, callback) => {
    // Same-origin / server-to-server requests have no Origin header
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ---------------------------------------------------------------------------
// Razorpay webhook — MUST be registered before express.json().
// Signature verification hashes the exact bytes Razorpay sent; a parsed and
// re-serialised body would produce a different digest and always fail.
// ---------------------------------------------------------------------------
app.use('/api/orders/webhook', express.raw({ type: 'application/json' }));

// ---------------------------------------------------------------------------
// Body parsing & cookies
// ---------------------------------------------------------------------------
app.use(express.json({ limit: '12mb' }));       // 12mb headroom for CSV imports
app.use(express.urlencoded({ extended: true, limit: '12mb' }));
app.use(cookieParser());

// Strip MongoDB operators ($, .) and obvious XSS payloads from user input
app.use(sanitize);

app.use(compression());

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600, // generous: a single product page fires several reads
  message: { success: false, message: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'OPTIONS',
});
app.use('/api', apiLimiter);

// Credential endpoints get a much tighter budget to blunt brute-force attempts
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, message: 'Too many authentication attempts, please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/products', productRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/brands', brandRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/coupons', couponRoutes);
app.use('/api/banners', bannerRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/search', searchRoutes);

// ---------------------------------------------------------------------------
// SEO endpoints — served at the domain root, generated live from the database
// ---------------------------------------------------------------------------
app.get('/sitemap.xml', getSitemap);
app.get('/robots.txt', getRobots);

// Health check for PM2 / uptime monitoring
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'AniLiving API is running',
    env: config.env,
    timestamp: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------
app.use(notFound);
app.use(errorHandler);

export default app;
