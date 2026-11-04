import * as service from '../services/address.service.js';

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

const PHONE_RE = /^(0|\+84)(3[2-9]|5[25689]|7[06-9]|8[1-9]|9[0-9])\d{7}$/;
const TYPE_ALLOWED = ['HOME', 'OFFICE'];

function validate(body) {
  const { fullName, phone, provinceCode, provinceName, communeCode, communeName, streetAddress, addressType } = body;
  if (!fullName?.trim()) return 'Họ và tên không được để trống.';
  if (!phone?.trim() || !PHONE_RE.test(phone.trim())) return 'Số điện thoại không hợp lệ.';
  if (!provinceCode || !provinceName) return 'Vui lòng chọn tỉnh/thành phố.';
  if (!communeCode || !communeName) return 'Vui lòng chọn phường/xã.';
  if (!streetAddress?.trim()) return 'Địa chỉ cụ thể không được để trống.';
  if (addressType && !TYPE_ALLOWED.includes(addressType)) return 'Loại địa chỉ không hợp lệ.';
  return null;
}

function pick(body) {
  return {
    fullName: body.fullName.trim(),
    phone: body.phone.trim(),
    provinceCode: body.provinceCode,
    provinceName: body.provinceName,
    communeCode: body.communeCode,
    communeName: body.communeName,
    streetAddress: body.streetAddress.trim(),
    addressType: body.addressType || 'HOME',
    isDefault: Boolean(body.isDefault),
  };
}

export const list = asyncHandler(async (req, res) => {
  const addresses = await service.listAddresses(req.user.userId);
  res.json({ addresses });
});

export const create = asyncHandler(async (req, res) => {
  const err = validate(req.body);
  if (err) return res.status(400).json({ message: err });
  const address = await service.createAddress(req.user.userId, pick(req.body));
  res.status(201).json({ address, message: 'Đã thêm địa chỉ.' });
});

export const update = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ message: 'ID không hợp lệ.' });
  const err = validate(req.body);
  if (err) return res.status(400).json({ message: err });
  const address = await service.updateAddress(req.user.userId, id, pick(req.body));
  if (!address) return res.status(404).json({ message: 'Địa chỉ không tồn tại.' });
  res.json({ address, message: 'Đã cập nhật địa chỉ.' });
});

export const remove = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ message: 'ID không hợp lệ.' });
  const deleted = await service.deleteAddress(req.user.userId, id);
  if (!deleted) return res.status(404).json({ message: 'Địa chỉ không tồn tại.' });
  res.json({ message: 'Đã xóa địa chỉ.' });
});

export const setDefault = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ message: 'ID không hợp lệ.' });
  const address = await service.setDefault(req.user.userId, id);
  if (!address) return res.status(404).json({ message: 'Địa chỉ không tồn tại.' });
  res.json({ address, message: 'Đã đặt làm địa chỉ mặc định.' });
});
