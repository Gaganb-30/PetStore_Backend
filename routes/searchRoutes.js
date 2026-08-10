import { Router } from 'express';
import { search, getPopularSearches } from '../controllers/searchController.js';

const router = Router();

router.get('/', search);
router.get('/popular', getPopularSearches);

export default router;
