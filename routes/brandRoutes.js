import { Router } from 'express';
import { protect, authorize } from '../middleware/auth.js';
import {
  getBrands, getBrandBySlug,
  getAdminBrands, createBrand, updateBrand, deleteBrand,
} from '../controllers/brandController.js';

const router = Router();

router.get('/', getBrands);
router.get('/admin/all', protect, authorize('admin'), getAdminBrands);
router.post('/', protect, authorize('admin'), createBrand);
router.get('/:slug', getBrandBySlug);
router.put('/:id', protect, authorize('admin'), updateBrand);
router.delete('/:id', protect, authorize('admin'), deleteBrand);

export default router;
