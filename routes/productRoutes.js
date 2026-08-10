import { Router } from 'express';
import { body } from 'express-validator';
import validate from '../middleware/validate.js';
import { protect, authorize } from '../middleware/auth.js';
import {
  getProducts, getProductFilters, getProductBySlug,
  getFeaturedProducts, getNewArrivals, getBestSellers,
  getTrendingProducts, getFlashDeals,
  createProduct, updateProduct, deleteProduct,
  bulkDeleteProducts, bulkUpdateStatus, duplicateProduct,
  getAdminProducts, getAdminProductById,
  getInventory, updateStock,
  exportProducts, importProducts,
} from '../controllers/productController.js';

const router = Router();
const adminOnly = [protect, authorize('admin')];

// ---------------------------------------------------------------------------
// Public — literal paths must be declared before the /:slug catch-all
// ---------------------------------------------------------------------------
router.get('/featured', getFeaturedProducts);
router.get('/new-arrivals', getNewArrivals);
router.get('/best-sellers', getBestSellers);
router.get('/trending', getTrendingProducts);
router.get('/flash-deals', getFlashDeals);
router.get('/filters', getProductFilters);

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------
router.get('/admin/all', ...adminOnly, getAdminProducts);
router.get('/admin/inventory', ...adminOnly, getInventory);
router.get('/admin/export', ...adminOnly, exportProducts);
router.post('/admin/import', ...adminOnly, importProducts);
router.get('/admin/:id', ...adminOnly, getAdminProductById);

router.post('/bulk-delete', ...adminOnly, bulkDeleteProducts);
router.post('/bulk-status', ...adminOnly, bulkUpdateStatus);
router.post('/:id/duplicate', ...adminOnly, duplicateProduct);
router.patch('/:id/stock', ...adminOnly, updateStock);

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------
router.get('/', getProducts);

router.post('/', ...adminOnly, [
  body('name').trim().notEmpty().withMessage('Product name is required'),
  body('price').isFloat({ min: 0 }).withMessage('A valid price is required'),
  body('category').notEmpty().withMessage('Category is required'),
], validate, createProduct);

router.put('/:id', ...adminOnly, [
  body('name').optional().trim().notEmpty().withMessage('Product name cannot be empty'),
  body('price').optional().isFloat({ min: 0 }).withMessage('A valid price is required'),
], validate, updateProduct);

router.delete('/:id', ...adminOnly, deleteProduct);

// Catch-all slug route stays last
router.get('/:slug', getProductBySlug);

export default router;
