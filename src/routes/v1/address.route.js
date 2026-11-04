import { Router } from 'express';
import { authenticateToken } from '../../middlewares/auth.middleware.js';
import * as controller from '../../controllers/address.controller.js';

const router = Router();
router.use(authenticateToken);

router.get('/', controller.list);
router.post('/', controller.create);
router.put('/:id', controller.update);
router.delete('/:id', controller.remove);
router.patch('/:id/default', controller.setDefault);

export default router;
