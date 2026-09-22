import Product from '../models/Product.js';
import Category from '../models/Category.js';
import Brand from '../models/Brand.js';
import config from '../config/index.js';

/**
 * Sitemap Service
 *
 * The sitemap is generated straight from MongoDB, so anything the admin
 * publishes is discoverable without a rebuild or a manual step. The rendered
 * XML is cached in memory and the cache is dropped the moment a product,
 * category or brand changes — see `invalidateSitemap()`, which the relevant
 * controllers call after every write.
 */

export const getDomain = () => {
  const d = String(process.env.DOMAIN || config.domain || 'https://aniliving.com').trim().replace(/\/+$/, '');
  return d;
};

const CACHE_TTL_MS = 15 * 60 * 1000; // hard ceiling even if nothing invalidates

let cache = { xml: null, generatedAt: 0 };

/** XML-escape a URL or text node */
const esc = (str = '') => String(str)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

const urlEntry = (loc, lastmod, changefreq = 'weekly', priority = '0.5', image) => `
  <url>
    <loc>${esc(loc)}</loc>${lastmod ? `
    <lastmod>${new Date(lastmod).toISOString().split('T')[0]}</lastmod>` : ''}
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>${image ? `
    <image:image><image:loc>${esc(image)}</image:loc></image:image>` : ''}
  </url>`;

/** Static routes that always belong in the sitemap */
const STATIC_PAGES = [
  { path: '/', priority: '1.0', changefreq: 'daily' },
  { path: '/shop', priority: '0.9', changefreq: 'daily' },
  { path: '/categories', priority: '0.8', changefreq: 'weekly' },
  { path: '/brands', priority: '0.8', changefreq: 'weekly' },
  { path: '/about', priority: '0.5', changefreq: 'monthly' },
  { path: '/contact', priority: '0.5', changefreq: 'monthly' },
  { path: '/faq', priority: '0.5', changefreq: 'monthly' },
  { path: '/track-order', priority: '0.4', changefreq: 'monthly' },
  { path: '/privacy-policy', priority: '0.3', changefreq: 'yearly' },
  { path: '/refund-policy', priority: '0.3', changefreq: 'yearly' },
  { path: '/shipping-policy', priority: '0.3', changefreq: 'yearly' },
  { path: '/cancellation-policy', priority: '0.3', changefreq: 'yearly' },
  { path: '/terms-and-conditions', priority: '0.3', changefreq: 'yearly' },
  { path: '/disclaimer', priority: '0.3', changefreq: 'yearly' },
];

/**
 * Build the sitemap XML from current database content.
 * Products are streamed in a lean query so a catalogue of tens of thousands of
 * items doesn't balloon the heap.
 */
export const buildSitemap = async () => {
  const [products, categories, brands] = await Promise.all([
    Product.find({ isActive: true }).select('slug updatedAt thumbnail').sort({ updatedAt: -1 }).lean(),
    Category.find({ isActive: true }).select('slug updatedAt').lean(),
    Brand.find({ isActive: true }).select('slug updatedAt').lean(),
  ]);

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"';
  xml += ' xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">';

  const domain = getDomain();

  for (const page of STATIC_PAGES) {
    xml += urlEntry(`${domain}${page.path}`, new Date(), page.changefreq, page.priority);
  }
  for (const p of products) {
    xml += urlEntry(`${domain}/product/${p.slug}`, p.updatedAt, 'weekly', '0.8', p.thumbnail);
  }
  for (const c of categories) {
    xml += urlEntry(`${domain}/shop?category=${c.slug}`, c.updatedAt, 'weekly', '0.7');
  }
  for (const b of brands) {
    xml += urlEntry(`${domain}/shop?brand=${b.slug}`, b.updatedAt, 'weekly', '0.6');
  }

  xml += '\n</urlset>';
  return xml;
};

/**
 * Cached accessor used by the /sitemap.xml route.
 */
export const generateSitemap = async () => {
  const fresh = cache.xml && (Date.now() - cache.generatedAt) < CACHE_TTL_MS;
  if (fresh) return cache.xml;

  const xml = await buildSitemap();
  cache = { xml, generatedAt: Date.now() };
  return xml;
};

/**
 * Drop the cached sitemap. Called after any content mutation so the next
 * crawler request regenerates it — this is what makes the sitemap "rebuild
 * itself" whenever a product/category/brand is added, edited or removed.
 */
export const invalidateSitemap = () => {
  cache = { xml: null, generatedAt: 0 };
};

/** robots.txt, pointing crawlers at the dynamic sitemap */
export const buildRobotsTxt = () => {
  const domain = getDomain();
  return `User-agent: *
Allow: /

# Nothing below this line is useful to a search engine
Disallow: /admin
Disallow: /dashboard
Disallow: /checkout
Disallow: /cart
Disallow: /order-success
Disallow: /order-failed
Disallow: /login
Disallow: /register
Disallow: /reset-password
Disallow: /api/

Sitemap: ${domain}/sitemap.xml
`;
};

export const getSitemapMeta = () => ({
  cached: Boolean(cache.xml),
  generatedAt: cache.generatedAt ? new Date(cache.generatedAt).toISOString() : null,
});
