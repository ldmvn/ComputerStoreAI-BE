// Customer support routes — authenticated users only (not admin-only).

import { Router } from 'express';
import { authenticateToken } from '../../middlewares/auth.middleware.js';
import * as controller from '../../controllers/customerSupport.controller.js';

const router = Router();
router.use(authenticateToken);

router.get('/',            controller.listMyTickets);
router.get('/:id',         controller.getMyTicket);
router.post('/:id/messages', controller.addMyMessage);

export default router;
