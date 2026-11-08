import { validateLoginInput, validateRegisterInput } from '../validators/auth.validator.js';
import { changePassword as changePasswordService, getCurrentUser, loginUser, registerUser, updateUserProfile } from '../services/auth.service.js';
import { logActivity } from '../services/activityLog.service.js';

const ACCESS_COOKIE = 'accessToken';
const cookieOpts = (rememberMe) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: '/',
  ...(rememberMe ? { maxAge: 30 * 24 * 60 * 60 * 1000 } : {}),
});

export async function register(req, res, next) {
  const { errors, values } = validateRegisterInput(req.body);
  if (Object.keys(errors).length > 0) {
    return res.status(400).json({ success: false, message: 'Dữ liệu đăng ký không hợp lệ.', errors });
  }

  try {
    const user = await registerUser(values);
    return res.status(201).json({ success: true, message: 'Đăng ký tài khoản thành công.', user });
  } catch (error) {
    return next(error);
  }
}

export async function login(req, res, next) {
  const { errors, values } = validateLoginInput(req.body);
  if (Object.keys(errors).length > 0) {
    return res.status(400).json({ success: false, message: 'Vui lòng nhập đầy đủ thông tin đăng nhập.', errors });
  }

  try {
    const rememberMe = req.body.rememberMe === true;
    const { token, user, permissions } = await loginUser(values);
    await logActivity({ req, userId: user.id, action: 'login', module: 'account', targetId: user.id, description: 'Đăng nhập' });
    res.cookie(ACCESS_COOKIE, token, cookieOpts(rememberMe));
    return res.status(200).json({ success: true, message: 'Đăng nhập thành công.', token, user, permissions });
  } catch (error) {
    return next(error);
  }
}

export function logout(_req, res) {
  res.clearCookie(ACCESS_COOKIE, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/' });
  return res.status(200).json({ success: true, message: 'Đăng xuất thành công.' });
}

export async function updateMe(req, res, next) {
  const { fullName, phone, gender } = req.body;
  if (fullName !== undefined && !String(fullName).trim()) {
    return res.status(400).json({ success: false, message: 'Họ và tên không được để trống.', field: 'fullName' });
  }
  try {
    const user = await updateUserProfile(req.user.userId, { fullName, phone, gender });
    await logActivity({ req, action: 'update_profile', module: 'account', targetId: req.user.userId, description: 'Cập nhật thông tin cá nhân' });
    return res.status(200).json({ success: true, user });
  } catch (error) {
    return next(error);
  }
}

export async function me(req, res, next) {
  try {
    const user = await getCurrentUser(req.user.userId);
    return res.status(200).json({ success: true, user });
  } catch (error) {
    return next(error);
  }
}

export async function changePassword(req, res, next) {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || typeof currentPassword !== 'string') {
    return res.status(400).json({ success: false, message: 'Vui lòng nhập mật khẩu hiện tại.', field: 'currentPassword' });
  }
  if (!newPassword || typeof newPassword !== 'string') {
    return res.status(400).json({ success: false, message: 'Vui lòng nhập mật khẩu mới.', field: 'newPassword' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ success: false, message: 'Mật khẩu mới phải có ít nhất 6 ký tự.', field: 'newPassword' });
  }
  if (newPassword === currentPassword) {
    return res.status(400).json({ success: false, message: 'Mật khẩu mới phải khác mật khẩu hiện tại.', field: 'newPassword' });
  }
  try {
    await changePasswordService(req.user.userId, { currentPassword, newPassword });
    await logActivity({ req, action: 'change_password', module: 'account', targetId: req.user.userId, description: 'Đổi mật khẩu' });
    return res.status(200).json({ success: true, message: 'Đổi mật khẩu thành công.' });
  } catch (error) {
    return next(error);
  }
}
