import { Router } from 'express';
import { authenticateToken } from '../../middlewares/auth.middleware.js';
import * as controller from '../../controllers/wishlist.controller.js';

const router = Router();
router.use(authenticateToken);
router.get('/', controller.list);
router.post('/:productId', controller.add);
router.delete('/:productId', controller.remove);
router.get('/check/:productId', controller.check);

export default router;