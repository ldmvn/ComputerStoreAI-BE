export function wishlistError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

export function positiveWishlistProductId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw wishlistError('Sản phẩm không hợp lệ.');
  return id;
}