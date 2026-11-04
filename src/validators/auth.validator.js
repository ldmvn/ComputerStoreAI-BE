const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phonePattern = /^(?:\+84|0)\d{8,10}$/;

export function validateRegisterInput(input = {}) {
  const fullName = typeof input.fullName === 'string' ? input.fullName.trim() : '';
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  const phone = typeof input.phone === 'string' ? input.phone.replace(/[\s.-]/g, '') : '';
  const password = typeof input.password === 'string' ? input.password : '';
  const errors = {};

  if (!fullName) errors.fullName = 'Vui lòng nhập họ và tên.';
  else if (fullName.length < 2 || fullName.length > 100) errors.fullName = 'Họ và tên phải từ 2 đến 100 ký tự.';
  if (!email) errors.email = 'Vui lòng nhập email.';
  else if (!emailPattern.test(email)) errors.email = 'Vui lòng nhập email hợp lệ.';
  if (!phone) errors.phone = 'Vui lòng nhập số điện thoại.';
  else if (!phonePattern.test(phone)) errors.phone = 'Vui lòng nhập số điện thoại hợp lệ.';
  if (!password) errors.password = 'Vui lòng nhập mật khẩu.';
  else if (password.length < 6) errors.password = 'Mật khẩu phải có ít nhất 6 ký tự.';
  else if (password.length > 128) errors.password = 'Mật khẩu không được vượt quá 128 ký tự.';

  return { errors, values: { fullName, email, phone, password } };
}

export function validateLoginInput(input = {}) {
  const identifier = typeof input.identifier === 'string' ? input.identifier.trim() : '';
  const password = typeof input.password === 'string' ? input.password : '';
  const errors = {};

  if (!identifier) errors.identifier = 'Vui lòng nhập email hoặc số điện thoại.';
  if (!password) errors.password = 'Vui lòng nhập mật khẩu.';

  return { errors, values: { identifier: identifier.toLowerCase(), password } };
}
