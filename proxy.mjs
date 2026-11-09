// Vercel Routing Middleware (vercel.json → "proxy"): the anti-ai rules from anti-ai.site.json,
// identical to docker/anti-ai for nginx. Runs before Vercel's cache, on every request.
// Plain ESM: Vercel runs this file as is in Node, without bundling.
import { createProxy } from './anti-ai/lib/vercel.mjs';
import policy from './anti-ai.policy.mjs';

export default createProxy(policy);
