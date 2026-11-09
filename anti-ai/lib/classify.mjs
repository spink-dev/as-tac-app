// The one decision every layer makes: what a request may see. Used directly by the Vercel proxy and
// the tests; the nginx configuration is generated from the same table (render.mjs enumerates
// `decideKinds` for every combination), so both servers answer identically.
//
// Kinds of client, in order of precedence:
//   signed AI agents (Web Bot Auth: `Signature-Agent`, or `Signature-Input` tagged web-bot-auth)
//   allow    user agents the site allows explicitly (monitoring)
//   ai       AI crawlers, assistants and agents (data/ai-robots.json + data/agents.json); a name
//            on both this and the preview or search list (facebookexternalhit, Applebot) is AI
//   preview  link previews of messengers (WhatsApp, Telegram, Discord …)
//   search   search engines
//   tool     scripts, HTTP libraries, headless and automated browsers, site copiers, scanners
//   bot      anything else that calls itself a bot, crawler or spider; an empty user agent
//   browser  everything else
// Kinds of path: trap, public (robots.txt, ai.txt, tdmrep.json), info (the public info page),
// info-asset (what that page loads), html (documents, the app shell), asset (everything else).

export const KINDS = ['allow', 'browser', 'preview', 'search', 'ai', 'tool', 'bot'];
/** Order in which user-agent lists are tried; the first match decides (nginx maps work the same). */
export const AGENT_ORDER = ['allow', 'ai', 'preview', 'search', 'tool', 'bot'];
export const PATH_KINDS = ['trap', 'public', 'info', 'info-asset', 'html', 'asset'];

/** A list of names as one case-insensitive pattern matching whole names only. */
export function namesPattern(names) {
    const seen = new Set();
    const unique = names
        .map((name) => name.trim())
        .filter((name) => name && !name.startsWith('__') && !seen.has(name.toLowerCase()) && seen.add(name.toLowerCase()));
    if (unique.length === 0) {
        return null;
    }
    // Longest first, so a longer name wins over a prefix of it. Special characters become
    // character classes: the same text then works in nginx (PCRE in a quoted string) and in JS.
    const escaped = unique
        .sort((a, b) => b.length - a.length || a.localeCompare(b))
        .map((name) => [...name].map((c) => (/[a-z0-9 _-]/i.test(c) ? c : c === '\\' || c === ']' || c === '^' ? `\\${c}` : `[${c}]`)).join(''));
    return `(?:^|[^a-z0-9])(?:${escaped.join('|')})(?:[^a-z0-9]|$)`;
}

/**
 * Site configuration + agent lists → the policy every layer applies (plain JSON, so the Vercel
 * proxy can import it as is).
 */
export function compilePolicy(site, lists) {
    const info = normalisePrefix(site.infoPath ?? '/about/');
    const trap = normalisePrefix(site.trapPath);
    if (!trap || trap === '/' || !/^\/[A-Za-z0-9_/-]+$/.test(trap)) {
        throw new Error('trapPath: a path such as /_/k7v2q9/ (letters, digits, - and _ only)');
    }
    const modes = {
        search: oneOf(site.search ?? 'info', ['info', 'deny'], 'search'),
        previews: oneOf(site.previews ?? 'info', ['info', 'deny'], 'previews'),
        ai: oneOf(site.ai ?? 'deny', ['info', 'deny'], 'ai'),
    };
    const aiNames = [...Object.keys(lists.aiRobots ?? {}), ...(lists.agents.ai ?? [])];
    return {
        format: 'anti-ai-policy',
        version: 1,
        name: String(site.name ?? ''),
        origin: String(site.origin ?? '').replace(/\/+$/, ''),
        infoPrefix: info,
        infoAssets: [...new Set(site.infoAssets ?? [])],
        publicPaths: ['/robots.txt', '/ai.txt', '/.well-known/tdmrep.json'],
        trapPrefix: trap,
        requireAcceptLanguage: site.requireAcceptLanguage !== false,
        modes,
        patterns: {
            allow: namesPattern(site.allowUserAgents ?? []),
            preview: namesPattern(lists.agents.preview ?? []),
            search: namesPattern(lists.agents.search ?? []),
            ai: namesPattern(aiNames),
            tool: namesPattern(lists.agents.tool ?? []),
            bot: lists.agents.genericBot ?? null,
        },
        robotsTag: {
            info: 'noarchive, noai, noimageai',
            other: 'noindex, nofollow, noarchive, nosnippet, noimageindex, notranslate, noai, noimageai',
        },
        denyBody: 'Forbidden: automated access, scraping and use for AI are not permitted.\n',
        rateLimit: {
            documentsPerSecond: Number(site.rateLimit?.documentsPerSecond ?? 5),
            burst: Number(site.rateLimit?.burst ?? 50),
        },
    };
}

function normalisePrefix(path) {
    if (typeof path !== 'string' || !path.startsWith('/')) {
        return null;
    }
    return path.replace(/\/+$/, '') || '/';
}

function oneOf(value, allowed, field) {
    if (!allowed.includes(value)) {
        throw new Error(`${field}: one of ${allowed.join(', ')}`);
    }
    return value;
}

const cache = new WeakMap();

function regexes(policy) {
    let compiled = cache.get(policy);
    if (!compiled) {
        compiled = Object.fromEntries(Object.entries(policy.patterns).map(([kind, source]) => [kind, source ? new RegExp(source, 'i') : null]));
        cache.set(policy, compiled);
    }
    return compiled;
}

/** The path as nginx sees it in `$uri`: decoded, repeated slashes merged, dot segments resolved. */
export function normalisePath(pathname) {
    let path = pathname;
    try {
        path = decodeURIComponent(pathname);
    } catch {
        // Broken escapes stay as they are (nginx answers those with 400 anyway).
    }
    const out = [];
    for (const segment of path.split('/')) {
        if (segment === '..') {
            out.pop();
        } else if (segment !== '.' && segment !== '') {
            out.push(segment);
        }
    }
    return `/${out.join('/')}${path.endsWith('/') && out.length ? '/' : ''}`;
}

export function pathKind(path, policy) {
    if (path === policy.trapPrefix || path.startsWith(`${policy.trapPrefix}/`)) {
        return 'trap';
    }
    if (policy.publicPaths.includes(path)) {
        return 'public';
    }
    if (policy.infoAssets.includes(path)) {
        return 'info-asset';
    }
    if (path === policy.infoPrefix || path.startsWith(`${policy.infoPrefix}/`)) {
        return 'info';
    }
    // Documents: a trailing slash, .html, or a last segment without a dot (the app's fallback).
    if (/\/[^/.]*$/.test(path) || /[.]html$/i.test(path)) {
        return 'html';
    }
    return 'asset';
}

/** `headers`: anything with `get(name)` (Fetch `Headers`) or a plain object with lower-case keys. */
export function agentKind(headers, policy) {
    const get = typeof headers?.get === 'function' ? (name) => headers.get(name) : (name) => headers?.[name] ?? null;
    if ((get('signature-agent') ?? '') !== '' || /web-bot-auth/i.test(get('signature-input') ?? '')) {
        return 'ai';
    }
    const ua = get('user-agent') ?? '';
    const re = regexes(policy);
    for (const kind of AGENT_ORDER) {
        if (re[kind]?.test(ua)) {
            return kind;
        }
    }
    return ua.trim() === '' ? 'bot' : 'browser';
}

/**
 * The action for one combination; pure, so the nginx map can be generated from it.
 * `allow` serve as asked · `info` serve the info page instead · `deny` 403 · `trap` 403 and record.
 */
export function decideKinds(kind, path, hasLanguage, policy) {
    if (path === 'trap') {
        return 'trap';
    }
    if (path === 'public') {
        return 'allow';
    }
    const infoOnly = (mode, rewriteDocuments) => {
        if (mode !== 'info') {
            return 'deny';
        }
        if (path === 'info' || path === 'info-asset') {
            return 'allow';
        }
        return rewriteDocuments && path === 'html' ? 'info' : 'deny';
    };
    switch (kind) {
        case 'allow':
            return 'allow';
        case 'browser':
            // Every browser sends Accept-Language with a page request; scripts usually don't.
            return path === 'html' && policy.requireAcceptLanguage && !hasLanguage ? 'deny' : 'allow';
        case 'preview':
            return infoOnly(policy.modes.previews, true);
        case 'search':
            // No rewrite for search engines: showing them other content than people see is cloaking.
            return infoOnly(policy.modes.search, false);
        case 'ai':
            return infoOnly(policy.modes.ai, false);
        default:
            return 'deny';
    }
}

/** `request`: `{ path, headers }` with the raw URL path. */
export function decide(request, policy) {
    const path = normalisePath(request.path);
    const kind = agentKind(request.headers, policy);
    const where = pathKind(path, policy);
    const get = typeof request.headers?.get === 'function' ? (name) => request.headers.get(name) : (name) => request.headers?.[name] ?? null;
    const hasLanguage = (get('accept-language') ?? '') !== '';
    const action = decideKinds(kind, where, hasLanguage, policy);
    return {
        action,
        kind,
        pathKind: where,
        robotsTag: where === 'info' || where === 'info-asset' ? policy.robotsTag.info : policy.robotsTag.other,
    };
}
