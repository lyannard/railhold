// Fallback so the repo also deploys when Vercel's Root Directory is left at the repo root.
// The real code lives in deploy/vercel/api/. (If Root Directory is deploy/vercel, this file is unused.)
import handler from '../deploy/vercel/api/signal.js';
export default handler;
