import { Router } from 'express';
import { protect, authorize } from '../middleware/auth.js';
import { getDashboardStats } from '../controllers/dashboardController.js';

const router = Router();

router.get('/', protect, authorize('admin'), getDashboardStats);

export default router;
