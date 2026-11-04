import { Router } from 'express';
import { authenticateToken } from '../../middlewares/auth.middleware.js';
import { listMine, updateMine, deleteMine } from '../../controllers/review.controller.js';

const router = Router();
router.use(authenticateToken);
router.get('/me', listMine);
router.patch('/me/:id', updateMine);
router.delete('/me/:id', deleteMine);

export default router;
