export function reviewError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function clampRating(value) {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 5) throw reviewError('Số sao phải là số nguyên từ 1 đến 5.');
  return number;
}

export function parseReviewPayload(input = {}) {
  const rating = clampRating(input.rating);
  const content = String(input.content || '').trim();
  if (content.length < 5) throw reviewError('Nhận xét phải có ít nhất 5 ký tự.');
  if (content.length > 2000) throw reviewError('Nhận xét tối đa 2000 ký tự.');
  return { rating, content };
}

export function parseReviewListQuery(query = {}) {
  const raw = String(query.rating || '').trim();
  let rating;
  if (raw) {
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5) throw reviewError('Bộ lọc sao không hợp lệ.');
    rating = parsed;
  }
  const page = Math.max(Number.parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(Number.parseInt(query.limit, 10) || 10, 1), 50);
  return { rating, page, limit };
}
