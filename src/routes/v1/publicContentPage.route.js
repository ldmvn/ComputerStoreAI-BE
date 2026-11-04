import { Router } from 'express';
import { publicGetPage } from '../../controllers/contentPage.controller.js';

const router = Router();

router.get('/:key', publicGetPage);

export default router;
