import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import {
  getCart, addToCart, updateCartItem, removeFromCart,
  clearCart, toggleSaveForLater, applyCoupon, removeCoupon,
} from '../controllers/cartController.js';

const router = Router();

router.get('/', protect, getCart);
router.post('/', protect, addToCart);
router.post('/apply-coupon', protect, applyCoupon);
router.delete('/remove-coupon', protect, removeCoupon);
router.put('/:itemId', protect, updateCartItem);
router.delete('/:itemId', protect, removeFromCart);
router.patch('/:itemId/save-for-later', protect, toggleSaveForLater);
router.delete('/', protect, clearCart);

export default router;
