import { generateSitemap, buildRobotsTxt, invalidateSitemap, getSitemapMeta } from '../services/sitemapService.js';
import { asyncHandler } from '../utils/helpers.js';

/**
 * @desc    Dynamic XML sitemap, generated from the database
 * @route   GET /sitemap.xml
 * @access  Public
 */
export const getSitemap = asyncHandler(async (req, res) => {
  const xml = await generateSitemap();
  res.set('Content-Type', 'application/xml; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=3600');
  res.send(xml);
});

/**
 * @desc    robots.txt pointing at the dynamic sitemap
 * @route   GET /robots.txt
 * @access  Public
 */
export const getRobots = (req, res) => {
  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=86400');
  res.send(buildRobotsTxt());
};

/**
 * @desc    Force a sitemap rebuild (useful right after a bulk import)
 * @route   POST /api/settings/sitemap/refresh
 * @access  Private/Admin
 */
export const refreshSitemap = asyncHandler(async (req, res) => {
  invalidateSitemap();
  await generateSitemap();
  res.json({ success: true, message: 'Sitemap regenerated.', data: getSitemapMeta() });
});
