import { Router } from 'express';
import { body } from 'express-validator';
import validate from '../middleware/validate.js';
import { protect, authorize } from '../middleware/auth.js';
import {
  createOrder, verifyPayment, retryPayment, getMyOrders, getOrderById,
  trackOrder, downloadInvoice, cancelOrder,
  getAllOrders, updateOrderStatus, getPaymentLogs, razorpayWebhook,
} from '../controllers/orderController.js';

const router = Router();

// ---------------------------------------------------------------------------
// Webhook — no auth; authenticity is proven by Razorpay's HMAC signature.
// The raw body parser for this path is registered in app.js.
// ---------------------------------------------------------------------------
router.post('/webhook/razorpay', razorpayWebhook);

// ---------------------------------------------------------------------------
// Public tracking — namespaced under /track so it can never shadow /:id
// ---------------------------------------------------------------------------
router.get('/track/:orderNumber', trackOrder);

// ---------------------------------------------------------------------------
// Admin (declared before /:id so the literal path wins)
// ---------------------------------------------------------------------------
router.get('/', protect, authorize('admin'), getAllOrders);
router.get('/:id/payment-logs', protect, authorize('admin'), getPaymentLogs);
router.patch('/:id/status', protect, authorize('admin'), updateOrderStatus);

// ---------------------------------------------------------------------------
// Customer
// ---------------------------------------------------------------------------
router.post('/', protect, [
  // Cash on delivery commented out for now - online payment via Razorpay only
  // body('paymentMethod').isIn(['razorpay', 'cod']).withMessage('Choose a valid payment method'),
  body('paymentMethod').isIn(['razorpay']).withMessage('Only online payment via Razorpay is accepted at this time'),
  body('shippingAddress.fullName').trim().notEmpty().withMessage('Full name is required'),
  body('shippingAddress.phone').trim().notEmpty().withMessage('Phone number is required'),
  body('shippingAddress.addressLine1').trim().notEmpty().withMessage('Address is required'),
  body('shippingAddress.city').trim().notEmpty().withMessage('City is required'),
  body('shippingAddress.state').trim().notEmpty().withMessage('State is required'),
  body('shippingAddress.pincode').trim().isLength({ min: 6, max: 6 }).withMessage('A valid 6-digit pincode is required'),
], validate, createOrder);

router.get('/my-orders', protect, getMyOrders);
router.post('/:id/verify-payment', protect, verifyPayment);
router.post('/:id/retry-payment', protect, retryPayment);
router.get('/:id/invoice', protect, downloadInvoice);
router.patch('/:id/cancel', protect, cancelOrder);
router.get('/:id', protect, getOrderById);

export default router;
