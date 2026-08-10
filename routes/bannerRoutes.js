import { Router } from 'express';
import { protect, authorize } from '../middleware/auth.js';
import { getBanners, getAdminBanners, createBanner, updateBanner, deleteBanner } from '../controllers/bannerController.js';

const router = Router();

router.get('/', getBanners);
router.get('/admin/all', protect, authorize('admin'), getAdminBanners);
router.post('/', protect, authorize('admin'), createBanner);
router.put('/:id', protect, authorize('admin'), updateBanner);
router.delete('/:id', protect, authorize('admin'), deleteBanner);

export default router;
