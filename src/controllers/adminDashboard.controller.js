import * as service from '../services/adminDashboard.service.js';

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const ALLOWED_RANGES = ['7d', '30d', 'month', '12m', 'custom'];

function safeRangeOf(req) {
  const { range, from, to } = req.query;
  return { range: ALLOWED_RANGES.includes(range) ? range : '7d', from, to };
}

export const getDashboard = asyncHandler(async (req, res) => {
  const data = await service.getDashboard(safeRangeOf(req));
  res.json(data);
});

export const getRevenueTimeline = asyncHandler(async (req, res) => {
  const { start, end, bucket } = service.resolveRange(safeRangeOf(req));
  const revenueTimeline = await service.getRevenueTimeline({ start, end, bucket });
  res.json({ revenueTimeline });
});

export const getCategoryRevenue = asyncHandler(async (req, res) => {
  const { start, end } = service.resolveRange(safeRangeOf(req));
  const categoryRevenue = await service.getCategoryRevenue({ start, end });
  res.json({ categoryRevenue });
});
