import { Router } from 'express';
import { authenticateToken } from '../../middlewares/auth.middleware.js';
import * as controller from '../../controllers/order.controller.js';

const router = Router();
router.use(authenticateToken);

router.post('/', controller.create);
router.get('/', controller.list);
router.get('/:id', controller.detail);
router.patch('/:id/cancel', controller.cancel);
router.patch('/:id/address', controller.updateAddress);
router.patch('/:id/payment-method', controller.updatePaymentMethod);
router.post('/:id/reorder', controller.reorder);

export default router;
