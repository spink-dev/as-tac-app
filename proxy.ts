// Vercel Routing Middleware (vercel.json → "proxy"): the anti-ai rules from anti-ai.site.json,
// identical to docker/anti-ai for nginx. Runs before Vercel's cache, on every request.
import { createProxy } from './anti-ai/lib/vercel.mjs';
import type { Policy } from './anti-ai/lib/classify.mjs';
import policy from './anti-ai.policy.json';

export default createProxy(policy as Policy);
