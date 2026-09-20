/**
 * End-to-end smoke test.
 *
 *   node scripts/smokeTest.js
 *
 * Boots the real Express app against an in-memory MongoDB and walks the
 * critical path: sign up, admin catalogue setup with colour variants, storefront
 * browsing and filtering, cart, a COD checkout, admin fulfilment with a tracking
 * link, public order tracking, invoice generation, CSV round-trip and the
 * SEO endpoints.
 *
 * Requires the dev-only packages `mongodb-memory-server` and `supertest`:
 *   npm i -D mongodb-memory-server supertest
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';

let passed = 0;
let failed = 0;
const failures = [];

const check = (name, condition, detail = '') => {
  if (condition) {
    passed += 1;
    console.log(`  ✅ ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

const section = (title) => console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 56 - title.length))}`);

const run = async () => {
  const mongo = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongo.getUri();
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test_secret_that_is_long_enough_for_testing';
  process.env.JWT_REFRESH_SECRET = 'test_refresh_secret_that_is_long_enough';
  process.env.DOMAIN = 'https://aniliving.test';

  // Imported after env is set so config picks up the in-memory URI
  const { default: app } = await import('../app.js');
  const { default: User } = await import('../models/User.js');
  const { default: Product } = await import('../models/Product.js');

  await mongoose.connect(process.env.MONGO_URI);
  const agent = request(app);

  // ===================================================================
  section('Health & SEO endpoints');
  // ===================================================================
  const health = await agent.get('/api/health');
  check('GET /api/health returns 200', health.status === 200);

  const robots = await agent.get('/robots.txt');
  check('robots.txt served', robots.status === 200 && robots.text.includes('Sitemap:'));
  check('robots.txt blocks /admin', robots.text.includes('Disallow: /admin'));

  // ===================================================================
  section('Authentication');
  // ===================================================================
  const register = await agent.post('/api/auth/register').send({
    firstName: 'Priya', lastName: 'Sharma',
    email: 'priya@example.com', password: 'Password123', phone: '9876543210',
  });
  check('customer can register', register.status === 201, register.body.message);
  const customerToken = register.body.data?.accessToken;
  check('register returns an access token', Boolean(customerToken));
  check('register never leaks the password hash', !JSON.stringify(register.body).includes('password'));

  const badLogin = await agent.post('/api/auth/login').send({ email: 'priya@example.com', password: 'wrong-pass' });
  check('wrong password is rejected', badLogin.status === 401);

  const login = await agent.post('/api/auth/login').send({ email: 'priya@example.com', password: 'Password123' });
  check('customer can log in', login.status === 200);

  // NoSQL injection attempt — the sanitiser must strip the $ operator
  const injection = await agent.post('/api/auth/login').send({ email: { $ne: null }, password: { $ne: null } });
  check('NoSQL injection payload is rejected', injection.status >= 400, `got ${injection.status}`);

  // Promote a second account to admin
  await User.create({
    firstName: 'Store', lastName: 'Admin', email: 'admin@example.com',
    password: 'AdminPass123', role: 'admin', authProvider: 'local',
  });
  const adminLogin = await agent.post('/api/auth/login').send({ email: 'admin@example.com', password: 'AdminPass123' });
  const adminToken = adminLogin.body.data?.accessToken;
  check('admin can log in', adminLogin.status === 200 && Boolean(adminToken));

  const auth = (token) => ({ Authorization: `Bearer ${token}` });

  const forbidden = await agent.get('/api/products/admin/all').set(auth(customerToken));
  check('customer cannot reach admin endpoints', forbidden.status === 403);

  // ===================================================================
  section('Catalogue setup (admin)');
  // ===================================================================
  const category = await agent.post('/api/categories').set(auth(adminToken)).send({
    name: 'Dog Food', description: 'Everything a dog eats', isActive: true,
  });
  check('admin can create a category', category.status === 201, category.body.message);
  const categoryId = category.body.data?.category?._id;

  const subcategory = await agent.post('/api/categories').set(auth(adminToken)).send({
    name: 'Dry Food', parent: categoryId, isActive: true,
  });
  check('admin can create a subcategory', subcategory.status === 201);

  const brand = await agent.post('/api/brands').set(auth(adminToken)).send({ name: 'PawPerfect' });
  check('admin can create a brand', brand.status === 201, brand.body.message);
  const brandId = brand.body.data?.brand?._id;

  // A product with colour + size variants — the "one card, many colours" case
  const productPayload = {
    name: 'All-Weather Dog Harness',
    shortDescription: 'Padded, reflective and adjustable.',
    category: categoryId,
    brand: brandId,
    price: 1299,
    mrp: 1799,
    stock: 0,
    sku: 'ANI-HAR-001',
    thumbnail: 'https://cdn.example.com/harness-red.jpg',
    tags: ['dog', 'harness'],
    features: ['Reflective stitching', 'Machine washable'],
    specifications: [
      { key: 'Material', value: 'Nylon' },
      { key: 'Weight', value: '240 g' },
    ],
    attributes: [
      { name: 'Color', values: ['Red', 'Blue', 'Black'] },
      { name: 'Size', values: ['M', 'L'] },
    ],
    variants: [
      { attributeCombination: { Color: 'Red', Size: 'M' }, price: 1299, mrp: 1799, stock: 5, sku: 'HAR-R-M', images: ['https://cdn.example.com/harness-red.jpg'] },
      { attributeCombination: { Color: 'Red', Size: 'L' }, price: 1399, mrp: 1899, stock: 4, sku: 'HAR-R-L', images: ['https://cdn.example.com/harness-red.jpg'] },
      { attributeCombination: { Color: 'Blue', Size: 'M' }, price: 1299, mrp: 1799, stock: 3, sku: 'HAR-B-M', images: ['https://cdn.example.com/harness-blue.jpg'] },
      { attributeCombination: { Color: 'Black', Size: 'L' }, price: 1349, mrp: 1849, stock: 0, sku: 'HAR-K-L', images: ['https://cdn.example.com/harness-black.jpg'] },
    ],
    isActive: true,
    isFeatured: true,
  };

  const created = await agent.post('/api/products').set(auth(adminToken)).send(productPayload);
  check('admin can create a product with variants', created.status === 201, JSON.stringify(created.body.message || created.body.errors));
  const productId = created.body.data?.product?._id;
  const productSlug = created.body.data?.product?.slug;
  check('slug is generated', productSlug === 'all-weather-dog-harness', productSlug);
  check('discount is derived from MRP', created.body.data?.product?.discount === 28, String(created.body.data?.product?.discount));
  check('specifications stored as a map', created.body.data?.product?.specifications?.Material === 'Nylon');

  // A second, simpler product so filters have something to narrow
  const product2 = await agent.post('/api/products').set(auth(adminToken)).send({
    name: 'Chicken & Rice Adult Kibble',
    category: categoryId,
    brand: brandId,
    price: 899,
    mrp: 999,
    stock: 40,
    sku: 'ANI-KIB-001',
    tags: ['dog', 'dry food'],
    attributes: [{ name: 'Weight', values: ['1kg', '3kg'] }],
    isActive: true,
    isBestSeller: true,
  });
  check('second product created', product2.status === 201);

  // ===================================================================
  section('Storefront catalogue');
  // ===================================================================
  const list = await agent.get('/api/products');
  check('product list is public', list.status === 200);
  check('both products are listed', list.body.data.products.length === 2, String(list.body.data.products.length));

  const harness = list.body.data.products.find((p) => p.slug === 'all-weather-dog-harness');
  check('colour options are collapsed onto one card', harness?.colorOptions?.length === 3, `got ${harness?.colorOptions?.length}`);
  check('each colour carries its own image', harness?.colorOptions?.[0]?.image?.includes('harness-'));
  check('variants are not shipped raw to the listing', harness?.variants === undefined);

  const facets = list.body.data.filters;
  check('facets include brands', facets.brands?.length === 1);
  check('facets include dynamic attributes', facets.attributes?.some((a) => a.name === 'Color'));
  check('price range facet computed', facets.priceRange?.min === 899 && facets.priceRange?.max === 1299,
    JSON.stringify(facets.priceRange));

  const filteredByColor = await agent.get('/api/products?attr_Color=Blue');
  check('dynamic attribute filter narrows results', filteredByColor.body.data.products.length === 1,
    String(filteredByColor.body.data.products.length));

  const filteredByPrice = await agent.get('/api/products?minPrice=1000');
  check('price filter works', filteredByPrice.body.data.products.length === 1);

  const searched = await agent.get('/api/products?search=kibble');
  check('search filter works', searched.body.data.products.length === 1);

  const bySlugCategory = await agent.get('/api/products?category=dog-food');
  check('category can be filtered by slug', bySlugCategory.body.data.products.length === 2);

  const missingCategory = await agent.get('/api/products?category=does-not-exist');
  check('unknown category slug returns nothing (not everything)', missingCategory.body.data.products.length === 0);

  const detail = await agent.get(`/api/products/${productSlug}`);
  check('product detail is public', detail.status === 200);
  check('detail exposes variants for the picker', detail.body.data.product.variants.length === 4);
  check('detail computes colour options', detail.body.data.product.colorOptions.length === 3);
  check('related products fall back to same category', detail.body.data.product.relatedProducts.length === 1);

  const instantSearch = await agent.get('/api/search?q=harness');
  check('instant search returns products', instantSearch.body.data.products.length === 1);
  check('instant search returns suggestions', instantSearch.body.data.suggestions.length >= 1);

  // ===================================================================
  section('Cart & checkout');
  // ===================================================================
  const variantId = detail.body.data.product.variants.find((v) => v.sku === 'HAR-R-M')._id;

  const addToCart = await agent.post('/api/cart').set(auth(customerToken)).send({
    productId, quantity: 2, variantId, variant: { Color: 'Red', Size: 'M' },
  });
  check('add to cart with a variant', addToCart.status === 200, addToCart.body.message);

  const overStock = await agent.post('/api/cart').set(auth(customerToken)).send({
    productId, quantity: 50, variantId,
  });
  check('cart rejects more than variant stock', overStock.status === 400, overStock.body.message);

  const noAddress = await agent.post('/api/orders').set(auth(customerToken)).send({
    paymentMethod: 'cod',
    shippingAddress: { fullName: 'Priya Sharma' },
  });
  check('order without a full address is rejected', noAddress.status === 400);

  const badPhone = await agent.post('/api/orders').set(auth(customerToken)).send({
    paymentMethod: 'cod',
    shippingAddress: {
      fullName: 'Priya Sharma', phone: '1234567890',
      addressLine1: '12 MG Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560001',
    },
  });
  check('invalid mobile number is rejected', badPhone.status === 400, badPhone.body.message);

  const order = await agent.post('/api/orders').set(auth(customerToken)).send({
    paymentMethod: 'cod',
    shippingAddress: {
      fullName: 'Priya Sharma', phone: '9876543210',
      addressLine1: '12 MG Road', addressLine2: 'Indiranagar',
      city: 'Bengaluru', state: 'Karnataka', pincode: '560001',
    },
  });
  check('COD order is placed', order.status === 201, order.body.message);
  const orderId = order.body.data?.order?._id;
  const orderNumber = order.body.data?.order?.orderNumber;
  check('order number generated', /^ANI-\d{8}-\d{4}[0-9A-F]{4}$/.test(orderNumber || ''), orderNumber);
  check('order priced from the variant, not the base product',
    order.body.data.order.itemsPrice === 2598, String(order.body.data.order.itemsPrice));
  check('tax computed as included GST', order.body.data.order.taxPrice > 0);

  const afterOrder = await Product.findById(productId);
  const redM = afterOrder.variants.find((v) => v.sku === 'HAR-R-M');
  check('variant stock decremented', redM.stock === 3, String(redM.stock));

  const emptyCart = await agent.post('/api/orders').set(auth(customerToken)).send({
    paymentMethod: 'cod',
    shippingAddress: {
      fullName: 'Priya Sharma', phone: '9876543210',
      addressLine1: '12 MG Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560001',
    },
  });
  check('ordering an empty cart is refused', emptyCart.status === 400);

  // ===================================================================
  section('Order management & tracking');
  // ===================================================================
  const shipped = await agent.patch(`/api/orders/${orderId}/status`).set(auth(adminToken)).send({
    status: 'shipped',
    note: 'Handed to courier',
    courierName: 'Delhivery',
    trackingNumber: 'DL123456789IN',
    trackingUrl: 'https://delhivery.com/track/DL123456789IN',
    estimatedDelivery: '2026-08-10',
  });
  check('admin can ship an order with tracking', shipped.status === 200, shipped.body.message);
  check('tracking link stored', shipped.body.data.order.trackingUrl.includes('delhivery'));

  const tracked = await agent.get(`/api/orders/track/${orderNumber}`);
  check('public tracking works without auth', tracked.status === 200);
  check('tracking exposes the courier link', tracked.body.data.order.trackingUrl.includes('delhivery'));
  check('tracking does not leak pricing', tracked.body.data.order.totalPrice === undefined);

  const delivered = await agent.patch(`/api/orders/${orderId}/status`).set(auth(adminToken)).send({ status: 'delivered' });
  check('delivered COD order is marked paid', delivered.body.data.order.isPaid === true);

  const cancelTooLate = await agent.patch(`/api/orders/${orderId}/cancel`).set(auth(customerToken)).send({});
  check('delivered order cannot be cancelled by the customer', cancelTooLate.status === 400);

  const invoice = await agent.get(`/api/orders/${orderId}/invoice`).set(auth(customerToken));
  check('invoice PDF generated', invoice.status === 200 && invoice.headers['content-type'].includes('pdf'));
  check('invoice has PDF magic bytes', Buffer.from(invoice.body).slice(0, 4).toString() === '%PDF');

  const otherUsersOrder = await agent.get(`/api/orders/${orderId}`);
  check('order detail requires auth', otherUsersOrder.status === 401);

  // ===================================================================
  section('Inventory & CSV');
  // ===================================================================
  const inventory = await agent.get('/api/products/admin/inventory').set(auth(adminToken));
  check('inventory summary computed', inventory.status === 200 && inventory.body.data.summary.totalProducts === 2);

  const restock = await agent.patch(`/api/products/${productId}/stock`).set(auth(adminToken))
    .send({ variantId, adjust: 10 });
  check('variant stock can be adjusted', restock.status === 200);
  const restocked = await Product.findById(productId);
  check('adjustment applied to the variant', restocked.variants.id(variantId).stock === 13,
    String(restocked.variants.id(variantId).stock));
  check('parent stock kept in sync with variants',
    restocked.stock === restocked.variants.reduce((s, v) => s + v.stock, 0), String(restocked.stock));

  const exported = await agent.get('/api/products/admin/export').set(auth(adminToken));
  check('CSV export works', exported.status === 200 && exported.text.split('\n').length === 3);
  check('CSV header includes specifications', exported.text.split('\n')[0].includes('specifications'));

  const reimport = await agent.post('/api/products/admin/import').set(auth(adminToken))
    .send({ csv: exported.text, updateExisting: true });
  check('CSV re-import updates rather than duplicates',
    reimport.body.data.updated === 2 && reimport.body.data.created === 0,
    JSON.stringify(reimport.body.data));

  const newRow = 'name,sku,category,price,stock,isActive\nCatnip Mouse Toy,ANI-TOY-001,Dog Food,199,25,true';
  const importNew = await agent.post('/api/products/admin/import').set(auth(adminToken))
    .send({ csv: newRow });
  check('CSV import creates new products', importNew.body.data.created === 1, JSON.stringify(importNew.body.data));

  const badRow = 'name,sku,category,price\nBroken Product,ANI-BAD-001,No Such Category,499';
  const importBad = await agent.post('/api/products/admin/import').set(auth(adminToken)).send({ csv: badRow });
  check('CSV import reports unknown categories', importBad.body.data.skipped === 1 && importBad.body.data.errors.length === 1);

  // ===================================================================
  section('Reviews, coupons & dashboard');
  // ===================================================================
  const review = await agent.post('/api/reviews').set(auth(customerToken)).send({
    productId, rating: 5, title: 'Great fit', comment: 'Bruno loves it, no chafing at all.',
  });
  check('customer can review a purchased product', review.status === 201, review.body.message);
  const reviewedProduct = await Product.findById(productId);
  check('product rating denormalised', reviewedProduct.ratingsCount === 1 && reviewedProduct.ratingsAverage === 5);
  check('verified-purchase badge applied', review.body.data?.review?.isVerifiedPurchase === true);

  const coupon = await agent.post('/api/coupons').set(auth(adminToken)).send({
    code: 'welcome10', type: 'percentage', value: 10,
    minOrderValue: 500, maxDiscount: 200,
    expiryDate: new Date(Date.now() + 7 * 86400000).toISOString(),
  });
  check('admin can create a coupon', coupon.status === 201, coupon.body.message);
  check('coupon code is upper-cased', coupon.body.data?.coupon?.code === 'WELCOME10');

  // Coupon must actually reduce the cart once applied
  await agent.post('/api/cart').set(auth(customerToken)).send({ productId, quantity: 1, variantId });
  const applied = await agent.post('/api/cart/apply-coupon').set(auth(customerToken)).send({ code: 'welcome10' });
  check('coupon applies to the cart', applied.status === 200, applied.body.message);
  check('cart returns the computed discount', applied.body.data.cart.coupon?.discount === 129.9,
    String(applied.body.data.cart.coupon?.discount));
  check('coupon discount is capped at maxDiscount', applied.body.data.cart.coupon.discount <= 200);

  const badCoupon = await agent.post('/api/cart/apply-coupon').set(auth(customerToken)).send({ code: 'NOPE' });
  check('unknown coupon is refused', badCoupon.status === 404);

  const removedCoupon = await agent.delete('/api/cart/remove-coupon').set(auth(customerToken));
  check('coupon can be removed', removedCoupon.status === 200 && removedCoupon.body.data.cart.coupon === null);

  // Wishlist must return cards the storefront can render directly
  const wishToggle = await agent.post(`/api/users/wishlist/${productId}`).set(auth(customerToken));
  check('product can be wishlisted', wishToggle.status === 200 && wishToggle.body.data.inWishlist === true);
  const wishlist = await agent.get('/api/users/wishlist').set(auth(customerToken));
  check('wishlist returns colour options for the card', wishlist.body.data.wishlist[0]?.colorOptions?.length === 3,
    String(wishlist.body.data.wishlist[0]?.colorOptions?.length));

  await agent.delete('/api/cart').set(auth(customerToken));

  const dashboard = await agent.get('/api/dashboard').set(auth(adminToken));
  check('dashboard analytics load', dashboard.status === 200);
  check('dashboard counts the paid order', dashboard.body.data.overview.totalOrders === 1);
  check('dashboard reports revenue', dashboard.body.data.overview.totalRevenue > 0);

  const settings = await agent.get('/api/settings');
  check('public settings expose integration status', settings.status === 200 && 'razorpayEnabled' in settings.body.data.integrations);
  check('settings never expose the Razorpay secret', !JSON.stringify(settings.body).includes('KEY_SECRET'));

  // ===================================================================
  section('Sitemap regeneration');
  // ===================================================================
  const sitemap = await agent.get('/sitemap.xml');
  check('sitemap served as XML', sitemap.status === 200 && sitemap.headers['content-type'].includes('xml'));
  check('sitemap lists products from the database', sitemap.text.includes('/product/all-weather-dog-harness'));
  check('sitemap lists categories', sitemap.text.includes('category=dog-food'));
  check('sitemap uses the configured domain', sitemap.text.includes('https://aniliving.test'));

  // A new product must appear without any manual step
  await agent.post('/api/products').set(auth(adminToken)).send({
    name: 'Ceramic Slow Feeder Bowl', category: categoryId, price: 649, stock: 12, isActive: true,
  });
  const sitemap2 = await agent.get('/sitemap.xml');
  check('sitemap auto-regenerates after a product is added',
    sitemap2.text.includes('/product/ceramic-slow-feeder-bowl'));

  // ===================================================================
  await mongoose.disconnect();
  await mongo.stop();

  console.log(`\n${'═'.repeat(64)}`);
  console.log(`  ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log('\n  Failures:');
    failures.forEach((f) => console.log(`   • ${f}`));
  }
  console.log(`${'═'.repeat(64)}\n`);

  process.exit(failed === 0 ? 0 : 1);
};

run().catch((err) => {
  console.error('\n💥 Smoke test crashed:', err);
  process.exit(1);
});
