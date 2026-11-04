import { Router } from 'express';
import { changePassword, login, logout, me, register, updateMe } from '../../controllers/auth.controller.js';
import { authenticateToken } from '../../middlewares/auth.middleware.js';
import { requestReset, verifyReset, completeReset } from '../../controllers/passwordReset.controller.js';
import { passwordResetRateLimit } from '../../middlewares/passwordResetRateLimit.middleware.js';
import { loginRateLimit, registerRateLimit } from '../../middlewares/rateLimit.middleware.js';
import { startGoogleLogin, googleCallback, completeGoogleLogin } from '../../controllers/googleAuth.controller.js';

const router = Router();

router.get('/google', startGoogleLogin);
router.get('/google/callback', googleCallback);
router.post('/google/exchange', completeGoogleLogin);

router.post('/register', registerRateLimit, register);
router.post('/login', loginRateLimit, login);
router.post('/logout', logout);
router.get('/me', authenticateToken, me);
router.patch('/me', authenticateToken, updateMe);
router.patch('/password', authenticateToken, changePassword);
router.post('/forgot-password', passwordResetRateLimit, requestReset);
router.post('/verify-reset-otp', passwordResetRateLimit, verifyReset);
router.post('/reset-password', passwordResetRateLimit, completeReset);

export default router;
