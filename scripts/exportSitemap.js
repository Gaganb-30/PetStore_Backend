import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import config from '../config/index.js';
import { buildSitemap, buildRobotsTxt } from '../services/sitemapService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Script to statically export sitemap.xml and robots.txt into the client directory.
 * Useful for static hosting or as a scheduled cron job on Hostinger.
 */
const exportSitemap = async () => {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(config.mongoUri);

    if (!process.env.DOMAIN || process.env.DOMAIN.includes('localhost')) {
      process.env.DOMAIN = 'https://aniliving.com';
    }

    console.log(`Generating sitemap XML for ${process.env.DOMAIN}...`);
    const xml = await buildSitemap();
    const robots = buildRobotsTxt();

    const targets = [
      path.resolve(__dirname, '../../client/public'),
      path.resolve(__dirname, '../../client/dist'),
    ];

    for (const targetDir of targets) {
      if (fs.existsSync(targetDir)) {
        fs.writeFileSync(path.join(targetDir, 'sitemap.xml'), xml, 'utf8');
        fs.writeFileSync(path.join(targetDir, 'robots.txt'), robots, 'utf8');
        console.log(`✅ Saved sitemap.xml and robots.txt to ${targetDir}`);
      }
    }

    console.log('Sitemap export completed successfully.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Failed to export sitemap:', err);
    process.exit(1);
  }
};

exportSitemap();
