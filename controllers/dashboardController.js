import Order from '../models/Order.js';
import Product from '../models/Product.js';
import User from '../models/User.js';
import { asyncHandler } from '../utils/helpers.js';

/**
 * @desc    Get dashboard analytics
 * @route   GET /api/dashboard
 * @access  Private/Admin
 */
export const getDashboardStats = asyncHandler(async (req, res) => {
  const today = new Date();
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const startOfLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const endOfLastMonth = new Date(today.getFullYear(), today.getMonth(), 0);

  // Parallel queries for performance
  const [
    totalRevenue,
    monthlyRevenue,
    lastMonthRevenue,
    totalOrders,
    monthlyOrders,
    pendingOrders,
    totalCustomers,
    totalProducts,
    lowStockProducts,
    recentOrders,
    topProducts,
    ordersByStatus,
    dailyRevenue,
  ] = await Promise.all([
    // Total revenue
    Order.aggregate([
      { $match: { isPaid: true, isCancelled: false } },
      { $group: { _id: null, total: { $sum: '$totalPrice' } } },
    ]),
    // Monthly revenue
    Order.aggregate([
      { $match: { isPaid: true, isCancelled: false, createdAt: { $gte: startOfMonth } } },
      { $group: { _id: null, total: { $sum: '$totalPrice' } } },
    ]),
    // Last month revenue
    Order.aggregate([
      { $match: { isPaid: true, isCancelled: false, createdAt: { $gte: startOfLastMonth, $lte: endOfLastMonth } } },
      { $group: { _id: null, total: { $sum: '$totalPrice' } } },
    ]),
    // Total orders
    Order.countDocuments(),
    // Monthly orders
    Order.countDocuments({ createdAt: { $gte: startOfMonth } }),
    // Pending orders
    Order.countDocuments({ status: { $in: ['pending', 'confirmed', 'processing'] } }),
    // Total customers
    User.countDocuments({ role: 'user' }),
    // Total products
    Product.countDocuments(),
    // Low stock — compares against each product's own threshold, not a magic number
    Product.countDocuments({
      isActive: true,
      $expr: { $and: [{ $gt: ['$stock', 0] }, { $lte: ['$stock', '$lowStockAlert'] }] },
    }),
    // Recent orders
    Order.find().populate('user', 'firstName lastName').sort({ createdAt: -1 }).limit(10).lean(),
    // Top selling products
    Order.aggregate([
      { $match: { isCancelled: false } },
      { $unwind: '$items' },
      { $group: { _id: '$items.product', name: { $first: '$items.name' }, totalSold: { $sum: '$items.quantity' }, revenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } } } },
      { $sort: { totalSold: -1 } },
      { $limit: 10 },
    ]),
    // Orders by status
    Order.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    // Daily revenue (last 30 days)
    Order.aggregate([
      { $match: { isPaid: true, createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, revenue: { $sum: '$totalPrice' }, orders: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
  ]);

  res.json({
    success: true,
    data: {
      overview: {
        totalRevenue: totalRevenue[0]?.total || 0,
        monthlyRevenue: monthlyRevenue[0]?.total || 0,
        lastMonthRevenue: lastMonthRevenue[0]?.total || 0,
        revenueGrowth: lastMonthRevenue[0]?.total
          ? (((monthlyRevenue[0]?.total || 0) - lastMonthRevenue[0].total) / lastMonthRevenue[0].total * 100).toFixed(1)
          : 0,
        totalOrders,
        monthlyOrders,
        pendingOrders,
        totalCustomers,
        totalProducts,
        lowStockProducts,
      },
      recentOrders,
      topProducts,
      ordersByStatus,
      dailyRevenue,
    },
  });
});
