import { validatePasswordReset } from '../validators/passwordReset.validator.js';
import { requestPasswordReset, verifyPasswordResetOtp, resetPassword } from '../services/passwordReset.service.js';

function handler(mode, action) {
  return async (req, res, next) => {
    const { errors, values } = validatePasswordReset(req.body, mode);
    if (Object.keys(errors).length) return res.status(400).json({ success: false, message: Object.values(errors)[0], errors });
    try { return res.json({ success: true, ...await action(values) }); }
    catch (error) { return next(error); }
  };
}
export const requestReset = handler('request', values => requestPasswordReset(values.email));
export const verifyReset = handler('verify', verifyPasswordResetOtp);
export const completeReset = handler('reset', resetPassword);
