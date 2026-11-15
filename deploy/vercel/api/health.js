'use strict';

/** GET /api/health tells the page whether multiplayer is configured on this deployment. */
module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const configured = Boolean((process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL) && (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN));
  res.status(200).json({ ok: true, multiplayer: configured });
};
