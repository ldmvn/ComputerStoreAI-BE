import { Router } from 'express';
import { slots, products, facets, validateBuild, createBuild, getBuild } from '../../controllers/buildPc.controller.js';
import { optionalAuth } from '../../middlewares/auth.middleware.js';
import { buildPostRateLimit } from '../../middlewares/rateLimit.middleware.js';

const router = Router();

router.get('/slots',    slots);
router.get('/products', products);
router.get('/facets',   facets);
router.post('/validate', validateBuild);
router.post('/builds', buildPostRateLimit, optionalAuth, createBuild);
router.get('/builds/:shareCode', getBuild);

export default router;
