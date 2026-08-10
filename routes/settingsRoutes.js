import { Router } from 'express';
import { protect, authorize } from '../middleware/auth.js';
import { getSettings, updateSettings } from '../controllers/settingsController.js';
import { refreshSitemap } from '../controllers/sitemapController.js';

const router = Router();

router.get('/', getSettings);
router.put('/', protect, authorize('admin'), updateSettings);

// Force a sitemap rebuild — handy right after a bulk CSV import
router.post('/sitemap/refresh', protect, authorize('admin'), refreshSitemap);

export default router;
