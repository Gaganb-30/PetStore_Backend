import { Router } from 'express';
import { optionalAuth } from '../middleware/auth.js';
import {
  generateCheckoutToken,
  getFastrrOrder,
  handleOrderWebhook,
  getFastrrProducts,
  getFastrrProductsByCollection,
  getFastrrCollections,
  fetchLoyaltyPoints,
  blockLoyaltyPoints,
  unblockLoyaltyPoints,
} from '../controllers/fastrrController.js';

const router = Router();

// Storefront checkout & order tracking
router.post('/checkout-token', generateCheckoutToken);
router.get('/order/:oid', optionalAuth, getFastrrOrder);

// Fastrr incoming order webhook
router.post('/webhook/order', handleOrderWebhook);

// Seller APIs called by Fastrr (Catalog & Collections)
router.get('/products', getFastrrProducts);
router.get('/collections/products', getFastrrProductsByCollection);
router.get('/collections/:collection_id/products', getFastrrProductsByCollection);
router.get('/collection-products', getFastrrProductsByCollection);
router.get('/collections', getFastrrCollections);

// Fastrr Loyalty Points Manager
router.post('/loyalty/points', fetchLoyaltyPoints);
router.post('/loyalty/block', blockLoyaltyPoints);
router.post('/loyalty/unblock', unblockLoyaltyPoints);

export default router;
