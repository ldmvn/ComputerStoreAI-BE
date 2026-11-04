import { Router } from 'express';
import { optionalAuth } from '../../middlewares/auth.middleware.js';
import { aiChatRateLimit } from '../../middlewares/rateLimit.middleware.js';
import { getStatus, postChat } from '../controllers/aiChat.controller.js';
import { postBuildPc } from '../controllers/aiBuildPc.controller.js';

export const aiRouter = Router();

// Public — the Floating Support Widget's Chatbot card checks this before
// enabling the chat input, so it should not require login.
aiRouter.get('/status', getStatus);

// optionalAuth, not authenticateToken: an anonymous visitor can still ask
// general/product_advice/faq questions. order_lookup-context requests from
// an anonymous caller are rejected inside the orderLookup tool (401), not
// blocked at the route, so the error message stays specific to that need.
aiRouter.post('/chat', aiChatRateLimit, optionalAuth, postChat);

// AI Build PC — generates an optimized PC configuration.
aiRouter.post('/build-pc', aiChatRateLimit, optionalAuth, postBuildPc);
