import dotenv from 'dotenv';
dotenv.config();

const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 5000,

  // MongoDB
  mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/aniliving',

  // JWT
  jwtSecret: process.env.JWT_SECRET || 'dev_jwt_secret_change_me',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || 'dev_jwt_refresh_secret_change_me',
  jwtExpire: process.env.JWT_EXPIRE || '15m',
  jwtRefreshExpire: process.env.JWT_REFRESH_EXPIRE || '7d',

  // Cookies — 'lax' works for same-site deployments (app + API behind one
  // domain via Nginx). Use 'none' only when the API lives on another domain,
  // which also requires HTTPS.
  cookieSameSite: process.env.COOKIE_SAME_SITE || 'lax',

  // Client
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',

  // Domain
  domain: process.env.DOMAIN || 'https://aniliving.com',

  // Google OAuth — used to verify ID tokens from Google Identity Services
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
  },

  // Razorpay
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID || '',
    keySecret: process.env.RAZORPAY_KEY_SECRET || '',
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || '',
  },

  // Email
  email: {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.EMAIL_FROM || 'AniLiving <noreply@aniliving.com>',
  },

  // MSG91 OTP
  msg91: {
    authKey:    process.env.MSG91_AUTH_KEY    || '',
    templateId: process.env.MSG91_TEMPLATE_ID || '',
    senderId:   process.env.MSG91_SENDER_ID   || 'ANILVG',
  },

  // How many minutes the user must wait before requesting a new OTP
  otpTimeoutMinutes: parseInt(process.env.OTP_TIMEOUT_MINUTES, 10) || 2,

  // Seller information for GST Tax Invoices
  seller: {
    name: process.env.SELLER_NAME || 'AniLiving',
    addressLine1: process.env.SELLER_ADDRESS_LINE1 || 'C-279, Karawal Nagar, Gali Number 7',
    addressLine2: process.env.SELLER_ADDRESS_LINE2 || 'Mukund Vihar',
    city: process.env.SELLER_CITY || 'North East Delhi',
    state: process.env.SELLER_STATE || 'Delhi',
    pincode: process.env.SELLER_PINCODE || '110094',
    country: process.env.SELLER_COUNTRY || 'IN',
    pan: process.env.SELLER_PAN || process.env.PAN_NUMBER || '',
    gstin: process.env.SELLER_GSTIN || process.env.GST_NUMBER || '',
  },
};

export default config;
