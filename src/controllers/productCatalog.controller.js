import { createProduct, getFilterMetadata, getProduct, getProductBySlug, listCategories, listProducts, removeImage, setStatus, softDeleteProduct, updateProduct, updateProductDescription } from '../services/productCatalog.service.js';
import { discardProductTemp, removeProductImage, saveDescriptionImage, saveProductImages, uploadDescriptionImageMiddleware } from '../services/productMedia.service.js';
import { parseFilterContextQuery, parseProductListQuery, parseProductPayload, productId, productError } from '../validators/product.validator.js';
import { recordProductView } from '../services/productStatistics.service.js';
import sanitizeHtml from 'sanitize-html';

const DESCRIPTION_SANITIZE = {
  allowedTags: ['h2','h3','h4','p','strong','em','u','s','a','ul','ol','li','blockquote','br','img','table','thead','tbody','tr','th','td'],
  allowedAttributes: { a: ['href','rel','target'], img: ['src','alt','width','height','style'], th: ['style'], td: ['style'], p: ['style'], h2: ['style'], h3: ['style'], h4: ['style'] },
  allowedStyles: { '*': { 'text-align': [/^(left|center|right|justify)$/] } },
};

const asyncHandler = handler => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);

function parseBody(req) {
  try { return parseProductPayload(req.body); } catch (error) { if (error instanceof SyntaxError) throw productError('Dữ liệu sản phẩm không hợp lệ.'); throw error; }
}

async function withImages(req, work) {
  let saved = [];
  try { saved = await saveProductImages(req.files || []); return await work(saved); }
  catch (error) { await Promise.all(saved.map(image => removeProductImage(image.storageKey))); throw error; }
  finally { await discardProductTemp(req.files || []); }
}

export const adminList = asyncHandler(async (req, res) => {
  const result = await listProducts(parseProductListQuery(req.query));
  res.json({ products: result.items, meta: result.meta, stats: result.stats });
});
export const categories = asyncHandler(async (_req, res) => res.json({ categories: await listCategories() }));
export const adminDetail = asyncHandler(async (req, res) => res.json({ product: await getProduct(productId(req.params.id)) }));
export const publicList = asyncHandler(async (req, res) => {
  const result = await listProducts({ ...parseProductListQuery(req.query), status: 'active' });
  res.json({ products: result.items, meta: result.meta, filters: result.filters });
});
export const publicFilters = asyncHandler(async (req, res) => res.json(await getFilterMetadata(parseFilterContextQuery(req.query))));
export const publicDetail = asyncHandler(async (req, res) => {
  const product = await getProductBySlug(req.params.slug);
  if (product?.description) product.description = sanitizeHtml(product.description, DESCRIPTION_SANITIZE);
  res.json({ product });
});
export const publicView = asyncHandler(async (req, res) => res.json(await recordProductView(req.params.slug, req.body?.viewId)));
export const create = asyncHandler(async (req, res) => withImages(req, async images => res.status(201).json({ product: await createProduct(parseBody(req), images), message: 'Đã tạo sản phẩm.' })));
export const update = asyncHandler(async (req, res) => withImages(req, async images => res.json({ product: await updateProduct(productId(req.params.id), parseBody(req), images), message: 'Đã cập nhật sản phẩm.' })));
export const status = asyncHandler(async (req, res) => res.json({ product: await setStatus(productId(req.params.id), req.body?.isActive === true || req.body?.isActive === 'true'), message: 'Đã cập nhật trạng thái sản phẩm.' }));
export const remove = asyncHandler(async (req, res) => res.json({ result: await softDeleteProduct(productId(req.params.id)), message: 'Đã ẩn sản phẩm.' }));
export const deleteImage = asyncHandler(async (req, res) => res.json({ product: await removeImage(productId(req.params.id), productId(req.params.imageId)), message: 'Đã xóa ảnh sản phẩm.' }));

export const patchDescription = asyncHandler(async (req, res) => {
  const id = productId(req.params.id);
  const raw = req.body?.description;
  if (typeof raw !== 'string') throw productError('Trường description bắt buộc là chuỗi.');
  const description = raw.trim() ? sanitizeHtml(raw.trim(), DESCRIPTION_SANITIZE) : null;
  const product = await updateProductDescription(id, description);
  res.json({ product, message: 'Đã cập nhật mô tả sản phẩm.' });
});

export const uploadDescriptionImageMw = uploadDescriptionImageMiddleware;
export const uploadDescriptionImage = asyncHandler(async (req, res) => {
  const result = await saveDescriptionImage(req.file);
  res.json({ data: { url: result.url } });
});
