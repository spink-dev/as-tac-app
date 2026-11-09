// Vercel Routing Middleware: the same decision as nginx, before Vercel's cache.
//   proxy.mjs:   import { createProxy } from './anti-ai/lib/vercel.mjs';
//                import policy from './anti-ai.policy.mjs';
//                export default createProxy(policy);
//   vercel.json: { "proxy": { "entrypoint": "proxy.mjs" } }
// Vercel runs this as native Node ESM (no bundling): relative imports need their extension.
import { next, rewrite } from '@vercel/functions';
import { decide } from './classify.mjs';

export function createProxy(policy) {
    return function proxy(request) {
        const url = new URL(request.url);
        const decision = decide({ path: url.pathname, headers: request.headers }, policy);
        const headers = { 'X-Robots-Tag': decision.robotsTag, 'tdm-reservation': '1' };
        if (decision.action === 'deny' || decision.action === 'trap') {
            if (decision.action === 'trap' || decision.kind !== 'browser') {
                // Function logs: who was refused (the trap marks clients that ignore robots.txt).
                console.log(JSON.stringify({
                    antiAi: decision.action,
                    kind: decision.kind,
                    path: url.pathname,
                    ua: (request.headers.get('user-agent') ?? '').slice(0, 300),
                    ip: (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim(),
                }));
            }
            return new Response(policy.denyBody, {
                status: 403,
                headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
            });
        }
        if (decision.action === 'info') {
            return rewrite(new URL(`${policy.infoPrefix}/`, url), { headers });
        }
        return next({ headers });
    };
}
