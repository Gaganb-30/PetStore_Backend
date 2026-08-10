import { Router } from 'express';
import { protect, authorize } from '../middleware/auth.js';
import {
  getProfile, updateProfile, changePassword,
  getAddresses, addAddress, updateAddress, deleteAddress,
  getWishlist, toggleWishlist,
  getAllUsers, updateUserStatus,
} from '../controllers/userController.js';

const router = Router();

// User profile
router.get('/profile', protect, getProfile);
router.put('/profile', protect, updateProfile);
router.put('/change-password', protect, changePassword);

// Addresses
router.get('/addresses', protect, getAddresses);
router.post('/addresses', protect, addAddress);
router.put('/addresses/:addressId', protect, updateAddress);
router.delete('/addresses/:addressId', protect, deleteAddress);

// Wishlist
router.get('/wishlist', protect, getWishlist);
router.post('/wishlist/:productId', protect, toggleWishlist);

// Admin: user management
router.get('/', protect, authorize('admin'), getAllUsers);
router.patch('/:id/status', protect, authorize('admin'), updateUserStatus);

export default router;
