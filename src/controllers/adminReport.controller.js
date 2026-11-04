import * as service from '../services/adminReport.service.js';

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

export const summary = asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const [revenue, topProducts, dailyRevenue, newCustomers] = await Promise.all([
    service.getRevenueSummary({ from, to }),
    service.getTopProducts({ from, to }),
    service.getDailyRevenue({ from, to }),
    service.getNewCustomers({ from, to }),
  ]);
  res.json({ revenue, topProducts, dailyRevenue, newCustomers });
});

export const revenue = asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const data = await service.getRevenueSummary({ from, to });
  res.json(data);
});

export const topProducts = asyncHandler(async (req, res) => {
  const { from, to, limit } = req.query;
  const data = await service.getTopProducts({ from, to, limit: limit ? parseInt(limit) : 10 });
  res.json({ topProducts: data });
});

export const dailyRevenue = asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const data = await service.getDailyRevenue({ from, to });
  res.json({ dailyRevenue: data });
});
