// Barrel for the Payment Module — server.js mounts these two routers at
// /api/payments (customer) and /api/admin/payments (admin). Internal pieces
// (payment.service, paymentConfirmation.service, validators) are imported by
// their own relative paths from inside this module and from
// order.service.js/adminOrder.service.js, which call into the Payment
// Module directly rather than going back through HTTP.
export { paymentRouter } from './routes/payment.routes.js';
export { adminPaymentRouter } from './routes/adminPayment.routes.js';
