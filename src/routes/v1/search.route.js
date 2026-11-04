import { Router } from 'express';
import { suggestions, searchProducts, trending, record } from '../../controllers/search.controller.js';

const router = Router();
router.get('/suggestions', suggestions);
router.get('/products', searchProducts);
router.get('/trending', trending);
router.post('/record', record);

export default router;
