import { getSettings, getSlots, listBuildPcProducts, getBuildPcFacets, validateBuildConfig, saveBuildConfig, loadBuildConfig } from '../services/buildPc.service.js';
import { parseAttributeFilters } from '../validators/product.validator.js';
import { MAX_ITEMS } from '../config/buildPc.config.js';

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

async function checkEnabled(res) {
  const settings = await getSettings();
  if (settings && !settings.manualBuildEnabled) {
    res.status(503).json({ message: 'Tính năng tự chọn linh kiện đang tạm đóng.' });
    return null;
  }
  return settings;
}

function parseInt(val, fallback) {
  const n = Number.parseInt(val, 10);
  return Number.isFinite(n) ? n : fallback;
}

function parseBuildPcQuery(query) {
  const brandId = query.brandId === undefined || query.brandId === '' ? undefined : parseInt(query.brandId, undefined);
  const minPrice = query.minPrice === undefined || query.minPrice === '' ? undefined : parseInt(query.minPrice, undefined);
  const maxPrice = query.maxPrice === undefined || query.maxPrice === '' ? undefined : parseInt(query.maxPrice, undefined);
  const attributeFilters = parseAttributeFilters(query);
  const page  = Math.max(parseInt(query.page, 1), 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 20), 1), 50);
  const q = String(query.q || '').trim().substring(0, 100) || undefined;
  const sort = String(query.sort || '').trim() || undefined;
  return { brandId, minPrice, maxPrice, attributeFilters, page, limit, search: q, sort, brand: String(query.brand || '').trim() };
}

// Parse and validate compatOnly + selected query params.
// Returns { compatOnly, selected } or throws a 400 error.
function parseCompatParams(query) {
  const compatOnly = query.compatOnly === 'true';
  const raw = String(query.selected || '').trim();
  if (!raw) return { compatOnly, selected: [] };

  const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length > MAX_ITEMS) {
    const err = new Error(`Tham số selected không được vượt quá ${MAX_ITEMS} dòng.`);
    err.statusCode = 400;
    throw err;
  }

  const selected = [];
  for (const part of parts) {
    const idx = part.lastIndexOf(':');
    if (idx <= 0) {
      const err = new Error(`Định dạng selected không hợp lệ: "${part}". Đúng: slot:productId.`);
      err.statusCode = 400;
      throw err;
    }
    const slot = part.slice(0, idx);
    const id = Number.parseInt(part.slice(idx + 1), 10);
    if (!slot || !Number.isFinite(id) || id <= 0) {
      const err = new Error(`productId trong selected phải là số nguyên dương: "${part}".`);
      err.statusCode = 400;
      throw err;
    }
    selected.push({ slot, productId: id });
  }
  return { compatOnly, selected };
}

export const slots = asyncHandler(async (req, res) => {
  const settings = await checkEnabled(res);
  if (!settings && res.headersSent) return;

  const result = await getSlots();
  res.json({ data: result.slots, meta: result.meta, message: 'OK' });
});

export const products = asyncHandler(async (req, res) => {
  const settings = await checkEnabled(res);
  if (settings === null && res.headersSent) return;

  const slotSlug = String(req.query.slot || '').trim();
  if (!slotSlug) {
    return res.status(400).json({ message: 'Thiếu tham số slot.' });
  }

  const VALID_SORTS = new Set(['default', 'price_asc', 'price_desc', 'name_asc']);
  const sort = String(req.query.sort || '').trim() || 'default';
  if (!VALID_SORTS.has(sort)) {
    return res.status(400).json({ message: `Tham số sort không hợp lệ. Các giá trị hợp lệ: ${[...VALID_SORTS].join(', ')}.` });
  }

  let compatParams;
  try {
    compatParams = parseCompatParams(req.query);
  } catch (err) {
    return res.status(err.statusCode || 400).json({ message: err.message });
  }

  const filters = { ...parseBuildPcQuery(req.query), sort };
  const result = await listBuildPcProducts(slotSlug, filters, settings, compatParams);
  res.json({ data: result.data, meta: result.meta, message: 'OK' });
});

export const facets = asyncHandler(async (req, res) => {
  const settings = await checkEnabled(res);
  if (settings === null && res.headersSent) return;

  const slotSlug = String(req.query.slot || '').trim();
  if (!slotSlug) {
    return res.status(400).json({ message: 'Thiếu tham số slot.' });
  }

  let compatParams;
  try {
    compatParams = parseCompatParams(req.query);
  } catch (err) {
    return res.status(err.statusCode || 400).json({ message: err.message });
  }

  const filters = parseBuildPcQuery(req.query);
  const result = await getBuildPcFacets(slotSlug, filters, settings, compatParams);
  res.json({ data: result.data, meta: result.meta, message: 'OK' });
});

export const validateBuild = asyncHandler(async (req, res) => {
  const settings = await getSettings();
  if (settings && !settings.manualBuildEnabled) {
    return res.status(503).json({ message: 'Tính năng tự chọn linh kiện đang tạm đóng.' });
  }

  try {
    const result = await validateBuildConfig(req.body?.items);
    res.json(result);
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ message: err.message || 'Lỗi server.' });
  }
});

export const createBuild = asyncHandler(async (req, res) => {
  const settings = await checkEnabled(res);
  if (settings === null && res.headersSent) return;

  const { items } = req.body ?? {};
  try {
    const result = await saveBuildConfig(items, req.user?.id ?? null);
    res.status(201).json({ data: result, message: 'Đã lưu cấu hình.' });
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ message: err.message || 'Lỗi server.' });
  }
});

export const getBuild = asyncHandler(async (req, res) => {
  const { shareCode } = req.params;
  try {
    const result = await loadBuildConfig(shareCode);
    res.json(result);
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ message: err.message || 'Lỗi server.' });
  }
});
