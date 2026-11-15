'use strict';
const { handleSignal, makeUpstashKv } = require('./_core.js');

/**
 * POST /api/signal?op=open|join|poll|answer|answer-get|close   (JSON body)
 * Needs an Upstash Redis REST database, connected through the Vercel Marketplace (it sets
 * KV_REST_API_URL and KV_REST_API_TOKEN) or by setting UPSTASH_REDIS_REST_URL and _TOKEN.
 */
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed', message: 'Use POST.' });
    return;
  }
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    res.status(503).json({ error: 'no_database', message: 'Multiplayer needs a Redis database. The site owner has not connected one yet. Solo play and Range Trials still work.' });
    return;
  }
  try {
    const op = typeof req.query.op === 'string' ? req.query.op : '';
    const out = await handleSignal(makeUpstashKv(url, token), op, req.body);
    res.status(out.status).json(out.json);
  } catch {
    res.status(502).json({ error: 'database_error', message: 'The room database did not answer. Try again in a moment.' });
  }
};
