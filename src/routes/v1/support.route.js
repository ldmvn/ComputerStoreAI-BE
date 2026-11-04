// Public support ticket routes — no auth required.
// Rate limit: 5 ticket creations per IP per 15 min.

import { Router } from 'express';
import { optionalAuth } from '../../middlewares/auth.middleware.js';
import * as controller from '../../controllers/support.controller.js';

// Simple in-memory rate limiter for ticket creation
const createBuckets = new Map();
function createRateLimit(req, res, next) {
  const now = Date.now();
  for (const [k, b] of createBuckets) if (b.expires <= now) createBuckets.delete(k);
  const key = req.ip;
  const bucket = createBuckets.get(key) || { count: 0, expires: now + 15 * 60 * 1000 };
  bucket.count++;
  createBuckets.set(key, bucket);
  if (bucket.count > 5) {
    res.set('Retry-After', String(Math.ceil((bucket.expires - now) / 1000)));
    return res.status(429).json({ success: false, message: 'Quá nhiều yêu cầu. Vui lòng thử lại sau ít phút.' });
  }
  return next();
}

const router = Router();

// POST /api/support/tickets  — create new ticket (public + optional auth)
router.post('/tickets', createRateLimit, optionalAuth, controller.createTicket);

// GET /api/support/ticket?code=&token=  — guest view (no auth)
router.get('/ticket', controller.getTicketGuest);

// POST /api/support/ticket/:id/messages  — guest reply
router.post('/ticket/:id/messages', optionalAuth, controller.addGuestMessage);

export default router;
