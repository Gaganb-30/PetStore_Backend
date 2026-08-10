/**
 * Seed script — populates MongoDB with test data for AniLiving
 * Run: node scripts/seed.js
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

import Category from '../models/Category.js';
import Brand from '../models/Brand.js';
import Product from '../models/Product.js';
import Banner from '../models/Banner.js';
import Settings from '../models/Settings.js';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/aniliving';

const categories = [
  { name: 'Collar', slug: 'collar', description: 'Premium collars for your pets', image: '/images/category-collar.png', sortOrder: 1 },
  { name: 'Bowls', slug: 'bowls', description: 'Feeding bowls and water dishes', image: '/images/category-bowls.png', sortOrder: 2 },
  { name: 'Toys', slug: 'toys', description: 'Fun and interactive pet toys', image: '/images/category-toys.png', sortOrder: 3 },
  { name: 'Leashes', slug: 'leashes', description: 'Durable walking leashes', image: '/images/category-leashes.png', sortOrder: 4 },
  { name: 'Harness', slug: 'harness', description: 'Comfortable pet harnesses', image: '/images/category-harness.png', sortOrder: 5 },
];

const brands = [
  { name: 'PawZone', slug: 'pawzone', description: 'Trusted pet accessories brand', logo: '/images/brand-pawzone.png' },
  { name: 'Royal Canin', slug: 'royal-canin', description: 'Premium pet nutrition', logo: '/images/brand-royal-canin.png' },
  { name: 'Himalaya', slug: 'himalaya', description: 'Natural pet care products', logo: '/images/brand-himalaya.png' },
  { name: 'Pedigree', slug: 'pedigree', description: 'Quality dog food and treats', logo: '/images/brand-pedigree.png' },
  { name: 'Drools', slug: 'drools', description: 'Affordable pet nutrition', logo: '/images/brand-drools.png' },
];

const generateProducts = (categoryIds, brandIds) => [
  // Collar products
  {
    name: 'Premium Leather Dog Collar - Brown', slug: 'premium-leather-dog-collar-brown',
    shortDescription: 'Genuine leather collar with brass buckle, soft padded interior for all-day comfort.',
    price: 699, mrp: 999, discount: 30,
    category: categoryIds['Collar'], brand: brandIds['PawZone'],
    tags: ['dogs', 'collar', 'leather'], thumbnail: '/images/products/collar-1.png',
    stock: 50, sku: 'COL-001', ratingsAverage: 4.7, ratingsCount: 234,
    isBestSeller: true, isFeatured: true,
  },
  {
    name: 'Reflective Nylon Cat Collar with Bell', slug: 'reflective-nylon-cat-collar-bell',
    shortDescription: 'Safety reflective collar with breakaway buckle and jingle bell for cats.',
    price: 249, mrp: 399, discount: 38,
    category: categoryIds['Collar'], brand: brandIds['PawZone'],
    tags: ['cats', 'collar', 'safety'], thumbnail: '/images/products/collar-2.png',
    stock: 120, sku: 'COL-002', ratingsAverage: 4.5, ratingsCount: 189, isNewArrival: true,
  },
  {
    name: 'Adjustable Nylon Dog Collar - Red', slug: 'adjustable-nylon-dog-collar-red',
    shortDescription: 'Lightweight, adjustable collar made from durable nylon.',
    price: 349, mrp: 499, discount: 30,
    category: categoryIds['Collar'], brand: brandIds['Drools'],
    tags: ['dogs', 'collar', 'nylon'], thumbnail: '/images/products/collar-3.png',
    stock: 80, sku: 'COL-003', ratingsAverage: 4.3, ratingsCount: 98, isTrending: true,
  },
  {
    name: 'Personalized Engraved Dog Collar', slug: 'personalized-engraved-dog-collar',
    shortDescription: 'Custom engraved collar with your pet\'s name and your phone number.',
    price: 899, mrp: 1299, discount: 31,
    category: categoryIds['Collar'], brand: brandIds['PawZone'],
    tags: ['dogs', 'collar', 'custom', 'premium'], thumbnail: '/images/products/collar-4.png',
    stock: 30, sku: 'COL-004', ratingsAverage: 4.9, ratingsCount: 312, isFeatured: true, isBestSeller: true,
  },
  // Bowl products
  {
    name: 'Stainless Steel Anti-Skid Dog Bowl – 900ml', slug: 'stainless-steel-anti-skid-dog-bowl',
    shortDescription: 'Non-slip rubber base, rust-resistant stainless steel. Dishwasher safe.',
    price: 399, mrp: 599, discount: 33,
    category: categoryIds['Bowls'], brand: brandIds['PawZone'],
    tags: ['dogs', 'bowl', 'stainless-steel'], thumbnail: '/images/products/bowl-1.png',
    stock: 200, sku: 'BWL-001', ratingsAverage: 4.6, ratingsCount: 567, isBestSeller: true, isFeatured: true,
  },
  {
    name: 'Ceramic Cat Feeding Bowl – Elevated', slug: 'ceramic-cat-feeding-bowl-elevated',
    shortDescription: 'Raised ceramic bowl that reduces neck strain. Beautiful minimalist design.',
    price: 599, mrp: 799, discount: 25,
    category: categoryIds['Bowls'], brand: brandIds['Himalaya'],
    tags: ['cats', 'bowl', 'ceramic', 'elevated'], thumbnail: '/images/products/bowl-2.png',
    stock: 60, sku: 'BWL-002', ratingsAverage: 4.8, ratingsCount: 123, isNewArrival: true, isFeatured: true,
  },
  {
    name: 'Slow Feeder Dog Bowl – Anti-Bloat', slug: 'slow-feeder-dog-bowl-anti-bloat',
    shortDescription: 'Puzzle design slows down eating by 10x. Prevents bloating and obesity.',
    price: 449, mrp: 649, discount: 31,
    category: categoryIds['Bowls'], brand: brandIds['Drools'],
    tags: ['dogs', 'bowl', 'slow-feeder'], thumbnail: '/images/products/bowl-3.png',
    stock: 90, sku: 'BWL-003', ratingsAverage: 4.4, ratingsCount: 201, isTrending: true,
  },
  // Toy products
  {
    name: 'Pet Rope Ball Tug Toy', slug: 'pet-rope-ball-tug-toy',
    shortDescription: 'Durable cotton rope toy with ball. Perfect for tug-of-war and fetch games.',
    price: 299, mrp: null, discount: 0,
    category: categoryIds['Toys'], brand: brandIds['PawZone'],
    tags: ['dogs', 'toy', 'rope', 'outdoor'], thumbnail: '/images/products/toy-1.png',
    stock: 300, sku: 'TOY-001', ratingsAverage: 4.6, ratingsCount: 980, isTrending: true, isFeatured: true,
  },
  {
    name: 'Interactive Cat Feather Wand Toy', slug: 'interactive-cat-feather-wand-toy',
    shortDescription: 'Telescopic wand with natural feathers. Triggers hunting instincts for indoor cats.',
    price: 199, mrp: 299, discount: 33,
    category: categoryIds['Toys'], brand: brandIds['PawZone'],
    tags: ['cats', 'toy', 'interactive', 'indoor'], thumbnail: '/images/products/toy-2.png',
    stock: 150, sku: 'TOY-002', ratingsAverage: 4.7, ratingsCount: 456, isBestSeller: true,
  },
  {
    name: 'Squeaky Plush Duck Dog Toy', slug: 'squeaky-plush-duck-dog-toy',
    shortDescription: 'Soft plush duck with built-in squeaker. Machine washable.',
    price: 349, mrp: 499, discount: 30,
    category: categoryIds['Toys'], brand: brandIds['Himalaya'],
    tags: ['dogs', 'toy', 'plush', 'squeaky'], thumbnail: '/images/products/toy-3.png',
    stock: 180, sku: 'TOY-003', ratingsAverage: 4.5, ratingsCount: 321, isNewArrival: true,
  },
  {
    name: 'Catnip Mouse Toy – 3 Pack', slug: 'catnip-mouse-toy-3-pack',
    shortDescription: 'Set of 3 realistic mice filled with premium organic catnip.',
    price: 249, mrp: 349, discount: 29,
    category: categoryIds['Toys'], brand: brandIds['Drools'],
    tags: ['cats', 'toy', 'catnip'], thumbnail: '/images/products/toy-4.png',
    stock: 250, sku: 'TOY-004', ratingsAverage: 4.3, ratingsCount: 178,
  },
  // Leash products
  {
    name: 'Premium Nylon Dog Leash – 5ft', slug: 'premium-nylon-dog-leash-5ft',
    shortDescription: 'Heavy-duty nylon leash with padded handle. Reflective stitching for night walks.',
    price: 399, mrp: 599, discount: 33,
    category: categoryIds['Leashes'], brand: brandIds['PawZone'],
    tags: ['dogs', 'leash', 'nylon', 'reflective'], thumbnail: '/images/products/leash-1.png',
    stock: 100, sku: 'LSH-001', ratingsAverage: 4.8, ratingsCount: 678, isBestSeller: true, isFeatured: true,
  },
  {
    name: 'Retractable Dog Leash – 16ft', slug: 'retractable-dog-leash-16ft',
    shortDescription: 'One-button brake and lock retractable leash. Tangle-free design.',
    price: 799, mrp: 1199, discount: 33,
    category: categoryIds['Leashes'], brand: brandIds['PawZone'],
    tags: ['dogs', 'leash', 'retractable'], thumbnail: '/images/products/leash-2.png',
    stock: 45, sku: 'LSH-002', ratingsAverage: 4.4, ratingsCount: 234, isTrending: true,
  },
  {
    name: 'Braided Leather Dog Leash – 4ft', slug: 'braided-leather-dog-leash-4ft',
    shortDescription: 'Handcrafted genuine leather leash. Gets softer with use.',
    price: 999, mrp: 1499, discount: 33,
    category: categoryIds['Leashes'], brand: brandIds['Himalaya'],
    tags: ['dogs', 'leash', 'leather', 'premium'], thumbnail: '/images/products/leash-3.png',
    stock: 25, sku: 'LSH-003', ratingsAverage: 4.9, ratingsCount: 145, isFeatured: true, isNewArrival: true,
  },
  {
    name: 'Cat Leash & Harness Combo', slug: 'cat-leash-harness-combo',
    shortDescription: 'Escape-proof cat harness with matching leash. Breathable mesh design.',
    price: 549, mrp: 799, discount: 31,
    category: categoryIds['Leashes'], brand: brandIds['PawZone'],
    tags: ['cats', 'leash', 'harness', 'outdoor'], thumbnail: '/images/products/leash-4.png',
    stock: 70, sku: 'LSH-004', ratingsAverage: 4.6, ratingsCount: 89,
  },
  // Harness products
  {
    name: 'No-Pull Dog Harness – Medium', slug: 'no-pull-dog-harness-medium',
    shortDescription: 'Front-clip design stops pulling instantly. Adjustable at 4 points.',
    price: 899, mrp: 1299, discount: 31,
    category: categoryIds['Harness'], brand: brandIds['PawZone'],
    tags: ['dogs', 'harness', 'no-pull', 'training'], thumbnail: '/images/products/harness-1.png',
    stock: 85, sku: 'HRN-001', ratingsAverage: 4.8, ratingsCount: 456, isBestSeller: true, isFeatured: true,
  },
  {
    name: 'Tactical Dog Harness with Handle', slug: 'tactical-dog-harness-handle',
    shortDescription: 'Military-grade harness with top handle and MOLLE system.',
    price: 1299, mrp: 1799, discount: 28,
    category: categoryIds['Harness'], brand: brandIds['PawZone'],
    tags: ['dogs', 'harness', 'tactical', 'premium'], thumbnail: '/images/products/harness-2.png',
    stock: 40, sku: 'HRN-002', ratingsAverage: 4.7, ratingsCount: 198, isTrending: true, isFeatured: true,
  },
  {
    name: 'Breathable Mesh Cat Harness', slug: 'breathable-mesh-cat-harness',
    shortDescription: 'Lightweight mesh harness designed specifically for cats.',
    price: 449, mrp: 649, discount: 31,
    category: categoryIds['Harness'], brand: brandIds['Drools'],
    tags: ['cats', 'harness', 'mesh', 'escape-proof'], thumbnail: '/images/products/harness-3.png',
    stock: 110, sku: 'HRN-003', ratingsAverage: 4.5, ratingsCount: 167, isNewArrival: true,
  },
  {
    name: 'Puppy Harness with Step-In Design', slug: 'puppy-harness-step-in-design',
    shortDescription: 'Easy step-in harness for puppies. Ultra-soft padding.',
    price: 599, mrp: 849, discount: 29,
    category: categoryIds['Harness'], brand: brandIds['Himalaya'],
    tags: ['dogs', 'harness', 'puppy', 'step-in'], thumbnail: '/images/products/harness-4.png',
    stock: 65, sku: 'HRN-004', ratingsAverage: 4.6, ratingsCount: 234, isBestSeller: true,
  },
];

const banners = [
  {
    title: 'Everything Your Pet Needs, Delivered',
    subtitle: 'Premium food, toys and accessories — free delivery on prepaid orders.',
    image: '/images/hero-banner.png',
    // A shorter crop for phones keeps the hero from swallowing the first screen
    mobileImage: '/images/hero-banner.png',
    link: '/shop',
    buttonText: 'Shop Now',
    sortOrder: 1,
    isActive: true,
  },
];

/**
 * Give a few products colour/size variants so the "one card, many colours"
 * behaviour is visible immediately after seeding.
 */
const withVariants = (products) => products.map((product) => {
  if (!product.sku?.startsWith('COL') && !product.sku?.startsWith('HRN')) return product;

  const colours = ['Brown', 'Black', 'Red'];
  const sizes = ['S', 'M', 'L'];

  return {
    ...product,
    attributes: [
      { name: 'Color', values: colours },
      { name: 'Size', values: sizes },
    ],
    variants: colours.flatMap((colour, ci) => sizes.map((size, si) => ({
      attributeCombination: { Color: colour, Size: size },
      price: product.price + si * 50,
      mrp: (product.mrp || product.price) + si * 50,
      // Vary stock so low-stock and out-of-stock states are both demonstrable
      stock: (ci === 2 && si === 2) ? 0 : 4 + ci * 3 + si,
      sku: `${product.sku}-${colour.slice(0, 2).toUpperCase()}-${size}`,
      images: [product.thumbnail],
      isActive: true,
    }))),
    specifications: {
      Material: product.sku.startsWith('COL') ? 'Genuine leather' : 'Nylon webbing',
      Closure: 'Quick-release buckle',
      Washable: 'Hand wash only',
      Origin: 'India',
    },
    features: [
      'Adjustable for a snug fit',
      'Reflective stitching for night walks',
      'Rust-proof hardware',
    ],
  };
});

async function seed() {
  try {
    console.log('🌱 Connecting to MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB');

    console.log('🗑️  Clearing existing data...');
    await Promise.all([
      Category.deleteMany({}),
      Brand.deleteMany({}),
      Product.deleteMany({}),
      Banner.deleteMany({}),
    ]);

    console.log('📁 Seeding categories...');
    const createdCategories = await Category.insertMany(categories);
    const categoryIds = {};
    createdCategories.forEach((c) => { categoryIds[c.name] = c._id; });
    console.log(`   ✅ ${createdCategories.length} categories created`);

    console.log('🏷️  Seeding brands...');
    const createdBrands = await Brand.insertMany(brands);
    const brandIds = {};
    createdBrands.forEach((b) => { brandIds[b.name] = b._id; });
    console.log(`   ✅ ${createdBrands.length} brands created`);

    console.log('📦 Seeding products...');
    const products = withVariants(generateProducts(categoryIds, brandIds));
    const createdProducts = await Product.insertMany(products);
    console.log(`   ✅ ${createdProducts.length} products created`);

    console.log('🖼️  Seeding homepage banners...');
    const createdBanners = await Banner.insertMany(banners);
    console.log(`   ✅ ${createdBanners.length} banners created`);

    console.log('⚙️  Ensuring store settings exist...');
    await Settings.getSettings();

    console.log('\n🎉 Seed complete!');
    console.log(`   Categories: ${createdCategories.length} | Brands: ${createdBrands.length} | Products: ${createdProducts.length} | Banners: ${createdBanners.length}`);
    console.log('   Next: run `npm run create-admin`, then sign in and open /admin\n');
    process.exit(0);
  } catch (error) {
    console.error('❌ Seed failed:', error.message);
    process.exit(1);
  }
}

seed();
