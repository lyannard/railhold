'use strict';
const { handleIce } = require('./_core.js');

/** GET /api/ice returns the ICE servers (STUN, plus a TURN relay when Cloudflare TURN is configured). */
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const out = await handleIce(process.env, fetch, req.headers.origin || '', req.headers.host || '');
    res.status(out.status).json(out.json);
  } catch {
    res.status(200).json({ turn: false, iceServers: null });
  }
};
