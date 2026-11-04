// ============================================================================
// Server Entry Point — ComputerStoreAI Backend
// ----------------------------------------------------------------------------
// Phase 1: khởi tạo Express + middlewares cơ bản + health check.
// Phase tiếp theo sẽ mount app.js (full app config) tại đây.
// ============================================================================

import './src/config/env.js';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import authRoutes from './src/routes/v1/auth.route.js';
import { publicBannerRouter, adminBannerRouter } from './src/routes/v1/banner.route.js';
import { publicProductSectionRouter, adminProductSectionRouter } from './src/routes/v1/productSection.route.js';
import { publicProductRouter, adminProductRouter } from './src/routes/v1/productCatalog.route.js';
import buildPcRouter from './src/routes/v1/buildPc.route.js';
import { publicCategoryRouter, adminCategoryRouter } from './src/routes/v1/category.route.js';
import { adminBrandRouter } from './src/routes/v1/brand.route.js';
import { publicMegaMenuRouter, adminMegaMenuRouter } from './src/routes/v1/megaMenu.route.js';
import { bannerMediaDirectory } from './src/services/media.service.js';
import { productMediaDirectory } from './src/services/productMedia.service.js';
import { brandMediaDirectory } from './src/services/brandMedia.service.js';
import { reviewMediaDirectory } from './src/services/reviewMedia.service.js';
import { brandingMediaDirectory } from './src/services/brandingMedia.service.js';

import { adminAttributeRouter, publicAttributeRouter } from './src/routes/v1/attribute.route.js';
import wishlistRoutes from './src/routes/v1/wishlist.route.js';
import addressRoutes from './src/routes/v1/address.route.js';
import reviewRoutes from './src/routes/v1/review.route.js';
import orderRoutes from './src/routes/v1/order.route.js';
import adminOrderRoutes from './src/routes/v1/adminOrder.route.js';
import adminCustomerRoutes from './src/routes/v1/adminCustomer.route.js';
import adminDashboardRoutes from './src/routes/v1/adminDashboard.route.js';
import adminBuildPcRoutes from './src/routes/v1/adminBuildPc.route.js';
import adminReturnRoutes from './src/routes/v1/adminReturn.route.js';
import adminReportRoutes from './src/routes/v1/adminReport.route.js';
import adminInventoryRoutes from './src/routes/v1/adminInventory.route.js';
import adminReviewRoutes from './src/routes/v1/adminReview.route.js';
import adminVoucherRoutes from './src/routes/v1/adminVoucher.route.js';
import voucherRoutes from './src/routes/v1/voucher.route.js';
import adminPromotionRoutes from './src/routes/v1/adminPromotion.route.js';
import searchRoutes from './src/routes/v1/search.route.js';
import rolesRoutes from './src/routes/v1/roles.route.js';
import activityLogRoutes from './src/routes/v1/activityLog.route.js';
import adminSettingsRoutes from './src/routes/v1/adminSettings.route.js';
import adminContentPageRoutes from './src/routes/v1/adminContentPage.route.js';
import publicContentPageRoutes from './src/routes/v1/publicContentPage.route.js';
import supportRoutes from './src/routes/v1/support.route.js';
import customerSupportRoutes from './src/routes/v1/customerSupport.route.js';
import adminSupportRoutes from './src/routes/v1/adminSupport.route.js';
import { aiRouter } from './src/ai/routes/ai.routes.js';
import { bootstrapAI } from './src/ai/bootstrap.js';
import adminBrandingRoutes from './src/routes/v1/adminBranding.route.js';
import { getPublicBranding } from './src/controllers/storeBranding.controller.js';
import { getPublicStore, getPublicPaymentStatus, getPublicFeatureFlags, getPublicSeo } from './src/controllers/storeSetting.controller.js';
import { promoMediaDirectory } from './src/services/promoMedia.service.js';
import { paymentRouter } from './src/payments/routes/payment.routes.js';
import { adminPaymentRouter } from './src/payments/routes/adminPayment.routes.js';

import { verifyResetMailConnection } from './src/services/passwordResetMail.service.js';
import { maintenanceGuard } from './src/middlewares/maintenance.middleware.js';
import { cleanupExpiredPasswordResets } from './src/services/passwordReset.service.js';
import { cancelExpiredOrders } from './src/services/order.service.js';

// ---------------------------------------------------------------------------
// App instance
// ---------------------------------------------------------------------------
const app = express();

// ---------------------------------------------------------------------------
// Trust proxy — MUST be set before any middleware that reads req.ip.
// TRUST_PROXY=1        → behind 1 layer (nginx, Docker). Use a number.
// TRUST_PROXY=loopback → trust only loopback. Use a named preset string.
// Unset / empty / false / 0 → no trust proxy (default Express behaviour).
// Never set to boolean true: trusts all X-Forwarded-For headers (IP spoofing risk).
// ---------------------------------------------------------------------------
{
  const raw = (process.env.TRUST_PROXY || '').trim();
  if (raw && raw !== 'false' && raw !== '0') {
    const numeric = Number(raw);
    const value = Number.isInteger(numeric) && numeric > 0 ? numeric : raw;
    app.set('trust proxy', value);
    console.log(`Express trust proxy = ${value}`);
  }
}

// ---------------------------------------------------------------------------
// Core middlewares
// ---------------------------------------------------------------------------
const configuredOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    const isLocalDevelopment = !origin || /^https?:\/\/localhost(:\d+)?$/.test(origin);
    if (isLocalDevelopment || configuredOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origin is not allowed by CORS.'));
  },
  credentials: true,
}));

app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Logger request cơ bản — Phase sau sẽ thay bằng morgan/winston
app.use((req, _res, next) => {
  const loggedUrl = req.path.startsWith('/api/auth/google') ? req.path : req.url;
  console.log(`[${new Date().toISOString()}] ${req.method} ${loggedUrl}`);
  next();
});

// ---------------------------------------------------------------------------
// Maintenance mode — blocks non-admin requests when enabled
// ---------------------------------------------------------------------------
app.use(maintenanceGuard);

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get('/api/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'computerstoreai-backend',
    message: 'Backend is running!',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/categories', publicCategoryRouter);
app.use('/api/admin/categories', adminCategoryRouter);
app.use('/api/admin/brands', adminBrandRouter);
app.use('/api/mega-menu', publicMegaMenuRouter);
app.use('/api/admin/mega-menu', adminMegaMenuRouter);
app.use('/api/banners', publicBannerRouter);
app.use('/api/admin/banners', adminBannerRouter);
app.use('/api/product-sections', publicProductSectionRouter);
app.use('/api/admin/product-sections', adminProductSectionRouter);
app.use('/api/v1/build-pc', buildPcRouter);
app.use('/api/products', publicProductRouter);
app.use('/api/admin/products', adminProductRouter);
app.use('/api/admin/attributes', adminAttributeRouter);
app.use('/api/attributes', publicAttributeRouter);
app.use('/api/wishlist', wishlistRoutes);
app.use('/api/addresses', addressRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/admin/orders', adminOrderRoutes);
app.use('/api/admin/customers', adminCustomerRoutes);
app.use('/api/admin/dashboard', adminDashboardRoutes);
app.use('/api/admin/build-pc', adminBuildPcRoutes);
app.use('/api/admin/returns', adminReturnRoutes);
app.use('/api/admin/reports', adminReportRoutes);
app.use('/api/admin/inventory', adminInventoryRoutes);
app.use('/api/admin/reviews', adminReviewRoutes);
app.use('/api/admin/vouchers', adminVoucherRoutes);
app.use('/api/vouchers', voucherRoutes);
app.use('/api/admin/promotions', adminPromotionRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/admin/roles', rolesRoutes);
app.use('/api/admin/activity-logs', activityLogRoutes);
app.use('/api/admin/settings', adminSettingsRoutes);
app.use('/api/content/pages',        publicContentPageRoutes);
app.use('/api/admin/content-pages',  adminContentPageRoutes);
app.use('/api/support',          supportRoutes);
app.use('/api/customer/support', customerSupportRoutes);
app.use('/api/admin/support-tickets', adminSupportRoutes);
app.use('/api/admin/branding', adminBrandingRoutes);
app.use('/api/payments', paymentRouter);
app.use('/api/admin/payments', adminPaymentRouter);
app.use('/api/ai', aiRouter);
app.get('/api/content/branding', getPublicBranding);
app.get('/api/content/store-info', getPublicStore);
app.get('/api/content/payment-status', getPublicPaymentStatus);
app.get('/api/content/features', getPublicFeatureFlags);
app.get('/api/content/seo', getPublicSeo);
app.use('/media/promo-sections', express.static(promoMediaDirectory, {
  dotfiles: 'deny', immutable: true, maxAge: '30d',
  setHeaders: res => res.set('X-Content-Type-Options', 'nosniff'),
}));

app.use('/media/banners', express.static(bannerMediaDirectory, {
  dotfiles: 'deny',
  immutable: true,
  maxAge: '1y',
  setHeaders: res => res.set('X-Content-Type-Options', 'nosniff'),
}));
app.use('/media/products', express.static(productMediaDirectory, {
  dotfiles: 'deny',
  immutable: true,
  maxAge: '1y',
  setHeaders: res => res.set('X-Content-Type-Options', 'nosniff'),
}));
app.use('/media/brands', express.static(brandMediaDirectory, {
  dotfiles: 'deny',
  immutable: true,
  maxAge: '1y',
  setHeaders: res => res.set('X-Content-Type-Options', 'nosniff'),
}));
app.use('/media/branding', express.static(brandingMediaDirectory, {
  dotfiles: 'deny',
  immutable: true,
  maxAge: '1y',
  setHeaders: res => res.set('X-Content-Type-Options', 'nosniff'),
}));
app.use('/media/reviews', express.static(reviewMediaDirectory, {
  dotfiles: 'deny',
  immutable: true,
  maxAge: '1y',
  setHeaders: res => res.set('X-Content-Type-Options', 'nosniff'),
}));


// ---------------------------------------------------------------------------
// 404 fallback
// ---------------------------------------------------------------------------
app.use((req, res) => {
  res.status(404).json({
    status: 'error',
    code: 404,
    message: `Route ${req.method} ${req.originalUrl} not found`,
  });
});

app.use((error, _req, res, _next) => {
  if (error?.code === 'P2025') return res.status(404).json({ success: false, message: 'Không tìm thấy dữ liệu yêu cầu.' });
  if (error?.code === 'P2034') return res.status(409).json({ success: false, message: 'Dữ liệu vừa thay đổi. Vui lòng tải lại và thử lại.' });
  if (error?.statusCode) {
    return res.status(error.statusCode).json({
      success: false,
      message: error.message,
      ...(error.field ? { field: error.field } : {}),
    });
  }

  console.error('Unhandled API error:', error?.message || error);
  return res.status(500).json({ success: false, message: 'Đã xảy ra lỗi máy chủ. Vui lòng thử lại sau.' });
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 5000;
const otpCleanupTimer = setInterval(() => {
  void cleanupExpiredPasswordResets().catch(error => console.error('[OTP] Cleanup failed:', error.code || error.name));
}, 60000);
otpCleanupTimer.unref();
const orderCancelTimer = setInterval(() => {
  void cancelExpiredOrders().catch(error => console.error('[AutoCancel] Failed:', error.code || error.name));
}, 300_000);
orderCancelTimer.unref();
const server = app.listen(PORT, () => {
  console.log('──────────────────────────────────────────────');
  console.log(`🚀 Backend is running at: http://localhost:${PORT}`);
  console.log(`❤️  Health check       : http://localhost:${PORT}/api/health`);
  console.log(`🌍 Environment        : ${process.env.NODE_ENV || 'development'}`);
  console.log('──────────────────────────────────────────────');
  void bootstrapAI().catch(err => console.warn('[AI] Bootstrap failed:', err.message));
  void verifyResetMailConnection().catch(() => {});
});

// Graceful shutdown
const shutdown = (signal) => {
  clearInterval(otpCleanupTimer);
  clearInterval(orderCancelTimer);
  console.log(`\n${signal} received. Closing server gracefully...`);
  server.close(() => {
    console.log('HTTP server closed.');
    process.exit(0);
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default app;
