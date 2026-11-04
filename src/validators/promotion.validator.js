export function parsePromotionListQuery(query) {
  const page = query.page ? Math.max(1, parseInt(query.page)) : 1;
  const limit = query.limit ? Math.min(100, Math.max(1, parseInt(query.limit))) : 20;
  return { page, limit, search: query.search, status: query.status, type: query.type, scope: query.scope };
}

export function promotionId(raw) {
  const id = parseInt(raw);
  if (!Number.isInteger(id) || id <= 0) {
    const e = new Error('ID không hợp lệ.');
    e.statusCode = 400;
    throw e;
  }
  return id;
}
