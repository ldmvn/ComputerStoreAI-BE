// IP limit is an additional per-process guard. Email cooldown/hourly limits persist in MySQL.
const buckets = new Map();
export function passwordResetRateLimit(req, res, next) {
  const now = Date.now();
  for (const [key, bucket] of buckets) if (bucket.expires <= now) buckets.delete(key);
  const key = req.ip;
  const bucket = buckets.get(key) || { count: 0, expires: now + 15 * 60 * 1000 };
  bucket.count++;
  buckets.set(key, bucket);
  if (bucket.count > 30) {
    res.set('Retry-After', String(Math.ceil((bucket.expires - now) / 1000)));
    return res.status(429).json({ success: false, message: 'Quá nhiều yêu cầu. Vui lòng thử lại sau ít phút.' });
  }
  res.set('Cache-Control', 'no-store');
  return next();
}
