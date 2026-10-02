import crypto from 'crypto';
import config from '../config/index.js';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import User from '../models/User.js';
import Settings from '../models/Settings.js';
import { sendOrderConfirmation } from './emailService.js';

/**
 * Fastrr Service (Shiprocket Custom Platform Checkout Integration)
 *
 * Implements HMAC SHA256 signature authentication, Checkout Access Token creation,
 * Order details polling, Fastrr webhook ingestion, and Catalog export.
 */

/**
 * Calculate HMAC SHA256 in Base64 using Fastrr API Secret
 */
export const calculateFastrrHmac = (secret, payload) => {
  const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return crypto.createHmac('sha256', secret || '').update(data).digest('base64');
};

/**
 * Get Fastrr Base URL depending on environment
 */
export const getFastrrBaseUrl = () => {
  if (config.fastrr.baseUrl) return config.fastrr.baseUrl.replace(/\/+$/, '');
  return config.fastrr.env === 'production'
    ? 'https://checkout-api.shiprocket.com'
    : 'https://fastrr-api-dev.pickrr.com';
};

/**
 * Create a Fastrr Checkout Access Token
 *
 * Called when a customer clicks "Checkout" in the Cart or "Buy Now" on a Product.
 *
 * @param {object} params
 * @param {Array<{ variantId?: string, productId?: string, quantity: number }>} params.items
 * @param {string} [params.redirectUrl]
 * @returns {Promise<{ token: string, orderId: string, raw: object }>}
 */
export const createCheckoutAccessToken = async ({ items = [], redirectUrl }) => {
  const apiKey = config.fastrr.apiKey?.trim();
  const apiSecret = config.fastrr.apiSecret?.trim();

  if (!apiKey || !apiSecret) {
    throw new Error('Fastrr API Key or Secret is not configured in server environment.');
  }

  // Map cart items into Fastrr format: { variant_id: string, quantity: number }
  const fastrrItems = items.map((it) => ({
    variant_id: String(it.variantId || it.productId),
    quantity: Math.max(1, parseInt(it.quantity, 10) || 1),
  }));

  const fallbackRedirect = `${config.clientUrl}/order-success`;
  const finalRedirect = redirectUrl || fallbackRedirect;

  const payload = {
    cart_data: {
      items: fastrrItems,
    },
    redirect_url: finalRedirect,
    timestamp: new Date().toISOString(),
  };

  const payloadString = JSON.stringify(payload);
  const hmac = calculateFastrrHmac(apiSecret, payloadString);
  const baseUrl = getFastrrBaseUrl();
  const url = `${baseUrl}/api/v1/access-token/checkout`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': apiKey,
      'X-Api-HMAC-SHA256': hmac,
    },
    body: payloadString,
  });

  const responseText = await response.text();
  let data;
  try {
    data = JSON.parse(responseText);
  } catch {
    console.error(`[Fastrr API Error] Non-JSON response (${response.status}):`, responseText);
    throw new Error('Error from payment provider. Please try again.');
  }

  if (!response.ok || !data.ok) {
    console.error(`[Fastrr API Error] (${response.status}):`, data);
    throw new Error('Error from payment provider. Please try again.');
  }

  return {
    token: data.result?.token,
    orderId: data.result?.data?.order_id,
    expiresAt: data.result?.expires_at,
    raw: data,
  };
};

/**
 * Fetch Order Details from Fastrr API
 *
 * @param {string} orderId Fastrr order ID
 */
export const getFastrrOrderDetails = async (orderId) => {
  const apiKey = config.fastrr.apiKey?.trim();
  const apiSecret = config.fastrr.apiSecret?.trim();

  if (!apiKey || !apiSecret) {
    throw new Error('Fastrr API credentials missing.');
  }

  const payload = {
    order_id: String(orderId),
    timestamp: new Date().toISOString(),
  };

  const payloadString = JSON.stringify(payload);
  const hmac = calculateFastrrHmac(apiSecret, payloadString);
  const baseUrl = getFastrrBaseUrl();
  const url = `${baseUrl}/api/v1/custom-platform-order/details`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': apiKey,
      'X-Api-HMAC-SHA256': hmac,
    },
    body: payloadString,
  });

  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.message || 'Failed to fetch Fastrr order details');
  }

  return data.result;
};

/**
 * Fetch Order Transactions from Fastrr API
 *
 * @param {string} orderId Fastrr order ID
 */
export const getFastrrOrderTransactions = async (orderId) => {
  const apiKey = config.fastrr.apiKey?.trim();
  const apiSecret = config.fastrr.apiSecret?.trim();

  if (!apiKey || !apiSecret) {
    throw new Error('Fastrr API credentials missing.');
  }

  const payload = {
    order_id: String(orderId),
    timestamp: new Date().toISOString(),
  };

  const payloadString = JSON.stringify(payload);
  const hmac = calculateFastrrHmac(apiSecret, payloadString);
  const baseUrl = getFastrrBaseUrl();
  const url = `${baseUrl}/api/v1/custom-platform-order/details/transactions`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': apiKey,
      'X-Api-HMAC-SHA256': hmac,
    },
    body: payloadString,
  });

  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.message || 'Failed to fetch Fastrr order transactions');
  }

  return data.result;
};

/**
 * Adjust stock for product/variant
 */
const adjustStock = async (productId, variantId, delta) => {
  if (variantId) {
    await Product.updateOne(
      { _id: productId, 'variants._id': variantId },
      { $inc: { 'variants.$.stock': delta, stock: delta } },
    );
  } else {
    await Product.updateOne({ _id: productId }, { $inc: { stock: delta } });
  }
};

/**
 * Ingest / Synchronize a Fastrr order into AniLiving's database
 *
 * Handles idempotency: if an order with `fastrrOrderId` already exists, updates status.
 * If new, creates user if necessary, resolves products, deducts inventory, and records order.
 *
 * @param {object} fastrrData Fastrr order object (from webhook or getOrderDetails)
 */
export const syncFastrrOrder = async (fastrrData) => {
  const fastrrOrderId = fastrrData.order_id || fastrrData.platform_order_id;
  if (!fastrrOrderId) {
    throw new Error('Missing Fastrr order_id in sync data.');
  }

  // 1. Check if already stored
  let order = await Order.findOne({ fastrrOrderId });

  const paymentType = fastrrData.payment_type || 'PREPAID';
  const paymentStatus = fastrrData.payment_status || 'Pending';
  const fastrrStatus = (fastrrData.status || '').toUpperCase();

  const isPaid = paymentStatus === 'Success' || (paymentType === 'PREPAID' && fastrrStatus === 'SUCCESS');

  let orderStatus = 'pending';
  if (fastrrStatus === 'FAILED') {
    orderStatus = 'cancelled';
  } else if (isPaid || paymentType === 'CASH_ON_DELIVERY') {
    orderStatus = 'confirmed';
  }

  if (order) {
    // Update existing order state
    const previousStatus = order.status;
    order.status = orderStatus;
    if (isPaid && !order.isPaid) {
      order.isPaid = true;
      order.paidAt = new Date();
    }
    order.paymentResult = {
      ...(order.paymentResult || {}),
      fastrrOrderId,
      status: paymentStatus,
      paidAt: isPaid ? (order.paidAt || new Date()) : undefined,
    };
    order.statusHistory.push({
      status: orderStatus,
      note: `Fastrr order update: status=${fastrrStatus}, paymentStatus=${paymentStatus}`,
      timestamp: new Date(),
    });
    await order.save();

    if (orderStatus === 'confirmed' && previousStatus !== 'confirmed') {
      const customer = await User.findById(order.user);
      if (customer) sendOrderConfirmation(customer, order);
    }

    return order;
  }

  // 2. Identify or create customer user
  const email = (fastrrData.email || fastrrData.shipping_address?.email || '').trim().toLowerCase();
  const phone = (fastrrData.phone || fastrrData.shipping_address?.phone || '').trim();

  let user = null;
  if (email) {
    user = await User.findOne({ email });
  }
  if (!user && phone) {
    user = await User.findOne({ phone });
  }

  if (!user) {
    // Create new customer account
    const firstName = fastrrData.shipping_address?.first_name || 'Customer';
    const lastName = fastrrData.shipping_address?.last_name || '';
    user = await User.create({
      firstName,
      lastName,
      email: email || undefined,
      phone: phone || undefined,
      role: 'customer',
      authProvider: 'email',
    });
  }

  // 3. Resolve cart items from Fastrr
  const rawItems = fastrrData.cart_data?.items || [];
  const orderItems = [];
  let calculatedSubtotal = 0;

  for (const rawItem of rawItems) {
    const identifier = String(rawItem.variant_id || rawItem.id);
    const quantity = Math.max(1, parseInt(rawItem.quantity, 10) || 1);

    // Try finding by variant ID first
    let product = await Product.findOne({ 'variants._id': identifier });
    let resolvedVariant = null;

    if (product) {
      resolvedVariant = product.variants.id(identifier);
    } else {
      // Find by product ID or SKU
      product = await Product.findById(identifier).catch(() => null);
      if (!product) {
        product = await Product.findOne({ sku: identifier });
      }
    }

    if (product) {
      const price = resolvedVariant ? resolvedVariant.price : product.price;
      const sku = resolvedVariant ? (resolvedVariant.sku || product.sku) : product.sku;
      const thumbnail = resolvedVariant?.images?.[0] || product.thumbnail || product.images?.[0] || '';

      orderItems.push({
        product: product._id,
        name: product.name,
        thumbnail,
        variant: resolvedVariant?.attributeCombination || new Map(),
        variantId: resolvedVariant?._id || undefined,
        sku,
        price,
        quantity,
      });

      calculatedSubtotal += price * quantity;

      // Deduct inventory
      await adjustStock(product._id, resolvedVariant?._id, -quantity);
    } else {
      // Fallback placeholder item if product was removed
      orderItems.push({
        name: `Product ${identifier}`,
        price: Number(rawItem.price) || 0,
        quantity,
        sku: identifier,
      });
      calculatedSubtotal += (Number(rawItem.price) || 0) * quantity;
    }
  }

  const shippingAddr = fastrrData.shipping_address || {};
  const shippingAddress = {
    fullName: [shippingAddr.first_name, shippingAddr.last_name].filter(Boolean).join(' ') || 'Customer',
    phone: shippingAddr.phone || phone || '0000000000',
    addressLine1: shippingAddr.line1 || 'Address Line 1',
    addressLine2: shippingAddr.line2 || '',
    city: shippingAddr.city || 'City',
    state: shippingAddr.state || 'State',
    pincode: String(shippingAddr.pincode || '000000'),
    country: shippingAddr.country || 'India',
  };

  const subtotalPrice = Number(fastrrData.subtotal_price) || calculatedSubtotal;
  const totalPrice = Number(fastrrData.total_amount_payable) || subtotalPrice;
  const discountAmount = Number(fastrrData.total_discount || fastrrData.coupon_discount) || 0;
  const shippingPrice = Number(fastrrData.cod_charges) || 0;

  // 4. Create Order document
  order = new Order({
    user: user._id,
    fastrrOrderId,
    items: orderItems,
    shippingAddress,
    paymentMethod: 'fastrr',
    paymentResult: {
      fastrrOrderId,
      status: paymentStatus,
      paidAt: isPaid ? new Date() : undefined,
    },
    itemsPrice: subtotalPrice,
    shippingPrice,
    discountAmount,
    totalPrice,
    status: orderStatus,
    statusHistory: [
      {
        status: orderStatus,
        note: `Order placed via Fastrr Checkout (ID: ${fastrrOrderId})`,
        timestamp: new Date(),
      },
    ],
    isPaid,
    paidAt: isPaid ? new Date() : undefined,
  });

  await order.save();

  if (orderStatus === 'confirmed') {
    sendOrderConfirmation(user, order);
  }

  return order;
};

/**
 * Formats a Product into Fastrr Catalog Product format
 */
export const formatProductForFastrr = (product) => {
  const images = (product.images || []).map((img) => ({ src: img }));
  if (!images.length && product.thumbnail) {
    images.push({ src: product.thumbnail });
  }

  // Build variants
  let variants = [];
  if (product.variants && product.variants.length > 0) {
    variants = product.variants.map((v) => {
      const vTitle = v.attributeCombination instanceof Map
        ? Array.from(v.attributeCombination.entries()).map(([k, val]) => `${k}: ${val}`).join(', ')
        : (v.attributeCombination ? Object.entries(v.attributeCombination).map(([k, val]) => `${k}: ${val}`).join(', ') : 'Default');

      return {
        id: String(v._id),
        title: vTitle || 'Default',
        price: String(v.price),
        sku: v.sku || product.sku || String(v._id),
        created_at: v.createdAt || product.createdAt,
        updated_at: v.updatedAt || product.updatedAt,
        taxable: true,
        grams: product.specifications?.get?.('Weight') ? parseInt(product.specifications.get('Weight'), 10) : 500,
        image: { src: v.images?.[0] || product.thumbnail || images[0]?.src || '' },
        weight: 0.5,
        weight_unit: 'kg',
      };
    });
  } else {
    variants = [
      {
        id: String(product._id),
        title: 'Default',
        price: String(product.price),
        sku: product.sku || String(product._id),
        created_at: product.createdAt,
        updated_at: product.updatedAt,
        taxable: true,
        grams: 500,
        image: { src: product.thumbnail || images[0]?.src || '' },
        weight: 0.5,
        weight_unit: 'kg',
      },
    ];
  }

  return {
    id: String(product._id),
    title: product.name,
    body_html: product.richDescription || product.longDescription || product.shortDescription || '',
    vendor: product.brand?.name || 'AniLiving',
    product_type: product.category?.name || 'Pet Supplies',
    created_at: product.createdAt,
    handle: product.slug,
    updated_at: product.updatedAt,
    tags: Array.isArray(product.tags) ? product.tags.join(', ') : '',
    status: product.isActive ? 'active' : 'draft',
    variants,
    image: {
      src: product.thumbnail || images[0]?.src || '',
    },
  };
};

/**
 * Formats Category into Fastrr Collection format
 */
export const formatCategoryForFastrr = (category) => ({
  id: String(category._id),
  title: category.name,
  handle: category.slug,
  body_html: category.description || '',
  image: {
    src: category.image || '',
  },
  created_at: category.createdAt,
  updated_at: category.updatedAt,
});

/**
 * Push Product update to Fastrr webhook
 */
export const notifyFastrrProductUpdate = async (product) => {
  const apiKey = config.fastrr.apiKey?.trim();
  const apiSecret = config.fastrr.apiSecret?.trim();
  if (!apiKey || !apiSecret) return;

  try {
    const formatted = formatProductForFastrr(product);
    const bodyStr = JSON.stringify(formatted);
    const hmac = calculateFastrrHmac(apiSecret, bodyStr);
    const baseUrl = getFastrrBaseUrl();

    await fetch(`${baseUrl}/wh/v1/custom/product`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
        'X-Api-HMAC-SHA256': hmac,
      },
      body: bodyStr,
    });
  } catch (err) {
    console.error('Fastrr product webhook error:', err.message);
  }
};

/**
 * Push Collection update to Fastrr webhook
 */
export const notifyFastrrCollectionUpdate = async (category) => {
  const apiKey = config.fastrr.apiKey?.trim();
  const apiSecret = config.fastrr.apiSecret?.trim();
  if (!apiKey || !apiSecret) return;

  try {
    const formatted = formatCategoryForFastrr(category);
    const bodyStr = JSON.stringify(formatted);
    const hmac = calculateFastrrHmac(apiSecret, bodyStr);
    const baseUrl = getFastrrBaseUrl();

    await fetch(`${baseUrl}/wh/v1/custom/collection`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
        'X-Api-HMAC-SHA256': hmac,
      },
      body: bodyStr,
    });
  } catch (err) {
    console.error('Fastrr collection webhook error:', err.message);
  }
};
