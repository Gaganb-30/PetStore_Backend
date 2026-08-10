import { Router } from 'express';
import { protect, authorize } from '../middleware/auth.js';
import {
  getProductReviews, createReview,
  replyToReview, toggleApproval, deleteReview, getAllReviews,
} from '../controllers/reviewController.js';

const router = Router();

router.get('/product/:productId', getProductReviews);
router.post('/', protect, createReview);

// Admin
router.get('/', protect, authorize('admin'), getAllReviews);
router.put('/:id/reply', protect, authorize('admin'), replyToReview);
router.patch('/:id/approve', protect, authorize('admin'), toggleApproval);
router.delete('/:id', protect, authorize('admin'), deleteReview);

export default router;
