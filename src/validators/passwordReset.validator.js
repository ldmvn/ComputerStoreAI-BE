export function validatePasswordReset(input = {}, mode = 'request') {
  if (!input || typeof input !== 'object') input = {};
  const email = typeof input?.email === 'string' ? input.email.trim().toLowerCase() : '';
  const errors = {};
  const values = { email };
  if (email.length > 191 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Vui lòng nhập email hợp lệ.';
  if (mode === 'verify') {
    values.otp = typeof input.otp === 'string' ? input.otp.trim() : '';
    values.challengeId = typeof input.challengeId === 'string' ? input.challengeId.trim() : '';
    if (!/^\d{6}$/.test(values.otp)) errors.otp = 'Mã OTP phải gồm 6 chữ số.';
    if (input.challengeId !== undefined && !/^[a-f0-9]{64}$/.test(values.challengeId)) errors.otp = 'Thông tin yêu cầu xác nhận không hợp lệ.';
  }
  if (mode === 'reset') {
    values.resetToken = typeof input.resetToken === 'string' ? input.resetToken : '';
    values.password = typeof input.password === 'string' ? input.password : '';
    if (!/^[a-f0-9]{64}$/.test(values.resetToken)) errors.resetToken = 'Phiên đổi mật khẩu không hợp lệ.';
    if (values.password.length < 6 || values.password.length > 128 || Buffer.byteLength(values.password, 'utf8') > 72) errors.password = 'Mật khẩu phải từ 6 đến 128 ký tự và tối đa 72 byte UTF-8.';
    if (values.password !== input.confirmPassword) errors.confirmPassword = 'Mật khẩu xác nhận không khớp.';
  }
  return { values, errors };
}
