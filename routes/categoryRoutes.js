import { Router } from 'express';
import { protect, authorize } from '../middleware/auth.js';
import {
  getCategories, getCategoryBySlug,
  getAdminCategories, createCategory, updateCategory, deleteCategory,
} from '../controllers/categoryController.js';

const router = Router();

router.get('/', getCategories);
router.get('/admin/all', protect, authorize('admin'), getAdminCategories);
router.post('/', protect, authorize('admin'), createCategory);
router.get('/:slug', getCategoryBySlug);
router.put('/:id', protect, authorize('admin'), updateCategory);
router.delete('/:id', protect, authorize('admin'), deleteCategory);

export default router;
