// Requests and the answers they must get, shared by the decision test and the real-nginx test.
// `site`: a test site; `expected` per path kind is the action.

export const site = {
    name: 'Test',
    origin: 'https://example.test',
    infoPath: '/about/',
    infoAssets: ['/icon-512.png'],
    trapPath: '/_/trap01/',
    search: 'info',
    previews: 'info',
    ai: 'deny',
    requireAcceptLanguage: true,
    rateLimit: { documentsPerSecond: 50, burst: 500 },
};

const LANG = { 'accept-language': 'de-CH,de;q=0.9,en;q=0.8' };
const HTML = { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' };

export const UA = {
    chrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
    galaxy: 'Mozilla/5.0 (Linux; Android 14; SM-A245F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
    samsung: 'Mozilla/5.0 (Linux; Android 14; SM-A245F) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36',
    firefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0',
    edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
    cubot: 'Mozilla/5.0 (Linux; Android 11; CUBOT X30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    facebookApp: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/480.0.0.0;FBBV/1;FBDV/iPhone16,1]',
    gptbot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)',
    chatgptUser: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot',
    claudebot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
    claudeUser: 'Claude-User (claude-code/2.0; +https://support.anthropic.com/)',
    claudeDesktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Claude/4.23118.0 Chrome/138.0.7204.251 Electron/37.6.0 Safari/537.36',
    perplexity: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)',
    ccbot: 'CCBot/2.0 (https://commoncrawl.org/faq/)',
    bytespider: 'Mozilla/5.0 (Linux; Android 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 (compatible; Bytespider; spider-feedback@bytedance.com)',
    metaAgent: 'meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)',
    facebookHit: 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
    applebot: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)',
    googleOther: 'GoogleOther',
    amazonbot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Amazonbot/0.1; +https://developer.amazon.com/support/amazonbot) Chrome/119.0.6045.214 Safari/537.36',
    googlebot: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    googlebotMobile: 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.122 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    bingbot: 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
    whatsapp: 'WhatsApp/2.24.20.89 A',
    imessage: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_1) facebookexternalhit/1.1 Facebot Twitterbot/1.0',
    telegram: 'TelegramBot (like TwitterBot)',
    discord: 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
    curl: 'curl/8.5.0',
    wget: 'Wget/1.21.4',
    requests: 'python-requests/2.32.3',
    go: 'Go-http-client/1.1',
    node: 'node',
    axios: 'axios/1.7.7',
    scrapy: 'Scrapy/2.11.2 (+https://scrapy.org)',
    headless: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36',
    postman: 'PostmanRuntime/7.39.0',
    java: 'Java/17.0.2',
    okhttp: 'okhttp/4.12.0',
    unknownBot: 'NewThingBot/0.3 (+https://example.org/bot)',
    unknownCrawler: 'Mozilla/5.0 (compatible; FooCrawler; +https://example.org)',
    empty: '',
    spaces: '   ',
};

/** [label, headers, kind] */
export const CLIENTS = [
    ...['chrome', 'iphone', 'galaxy', 'samsung', 'firefox', 'edge', 'cubot', 'facebookApp'].map((name) => [name, { 'user-agent': UA[name], ...LANG, ...HTML }, 'browser']),
    ['chrome-without-language', { 'user-agent': UA.chrome, ...HTML }, 'browser'],
    ['chatgpt-agent-signed', { 'user-agent': UA.chrome, ...LANG, ...HTML, 'signature-agent': '"https://chatgpt.com"', 'signature-input': 'sig1=("@authority");tag="web-bot-auth";alg="ed25519"' }, 'ai'],
    ['web-bot-auth-input-only', { 'user-agent': UA.chrome, ...LANG, ...HTML, 'signature-input': 'sig1=();tag="web-bot-auth"' }, 'ai'],
    ...['gptbot', 'chatgptUser', 'claudebot', 'claudeUser', 'claudeDesktop', 'perplexity', 'ccbot', 'bytespider', 'metaAgent', 'applebot', 'googleOther', 'amazonbot', 'scrapy'].map((name) => [name, { 'user-agent': UA[name], ...LANG }, 'ai']),
    ...['googlebot', 'googlebotMobile', 'bingbot'].map((name) => [name, { 'user-agent': UA[name] }, 'search']),
    ...['whatsapp', 'telegram', 'discord', 'facebookHit', 'imessage'].map((name) => [name, { 'user-agent': UA[name] }, 'preview']),
    ...['curl', 'wget', 'requests', 'go', 'node', 'axios', 'headless', 'postman', 'java', 'okhttp'].map((name) => [name, { 'user-agent': UA[name], ...LANG }, 'tool']),
    ...['unknownBot', 'unknownCrawler', 'empty', 'spaces'].map((name) => [name, { 'user-agent': UA[name] }, 'bot']),
];

/** [path, path kind] */
export const PATHS = [
    ['/', 'html'],
    ['/index.html', 'html'],
    ['/some/deep/link', 'html'],
    ['/about/', 'info'],
    ['/about', 'info'],
    ['/%61bout/', 'info'],
    ['//about//', 'info'],
    ['/aboutx', 'html'],
    ['/icon-512.png', 'info-asset'],
    ['/assets/app.js', 'asset'],
    ['/maps/de/mahlwinkel.geojson', 'asset'],
    ['/robots.txt', 'public'],
    ['/ai.txt', 'public'],
    ['/.well-known/tdmrep.json', 'public'],
    ['/_/trap01/', 'trap'],
    ['/_/trap01/deeper', 'trap'],
];

/** The answer each client kind must get for each path kind (with Accept-Language as given). */
export function expected(kind, pathKind, hasLanguage) {
    if (pathKind === 'trap') {
        return 'trap';
    }
    if (pathKind === 'public') {
        return 'allow';
    }
    switch (kind) {
        case 'browser':
            return pathKind === 'html' && !hasLanguage ? 'deny' : 'allow';
        case 'search':
            return pathKind === 'info' || pathKind === 'info-asset' ? 'allow' : 'deny';
        case 'preview':
            return pathKind === 'info' || pathKind === 'info-asset' ? 'allow' : pathKind === 'html' ? 'info' : 'deny';
        default:
            return 'deny';
    }
}

/** Real browser and in-app browser user agents: all of them are people. */
export const REAL_BROWSERS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Linux; Android 14; SM-A245F Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Linux; Android 14; SM-A245F) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Linux; U; Android 13; de-ch; 2201117TG Build/TKQ1.221114.001) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/118.0.0.0 Mobile Safari/537.36 XiaoMi/MiuiBrowser/14.9.0-gn',
    'Mozilla/5.0 (Linux; Android 12; NOH-NX9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 HuaweiBrowser/15.0.4.312 Mobile Safari/537.36',
    'Mozilla/5.0 (Linux; U; Android 11; en-US; RMX2185 Build/RP1A.200720.011) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/100.0.4896.58 UCBrowser/13.6.0.1315 Mobile Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 OPR/124.0.0.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 YaBrowser/25.10.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Vivaldi/7.6',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36 EdgA/141.0.0.0',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 EdgiOS/141.0.0.0 Mobile/15E148 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0',
    'Mozilla/5.0 (Android 14; Mobile; rv:144.0) Gecko/144.0 Firefox/144.0',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/144.0 Mobile/15E148 Safari/605.1.15',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.0.0 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/388.0.0 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (iPad; CPU OS 17_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.7 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 12_5_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1.2 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 400.0.0.0.0 (iPhone16,1; iOS 18_6; de_CH; de; scale=3.00; 1179x2556; 0)',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/480.0.0.0;FBBV/1;FBDV/iPhone16,1;FBMD/iPhone;FBSN/iOS;FBSV/18.6;FBSS/3;FBID/phone;FBLC/de_DE;FBOP/5]',
    'Mozilla/5.0 (Linux; Android 14; SM-A245F Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36 [FB_IAB/Orca-Android;FBAV/480.0.0.0;]',
    'Mozilla/5.0 (Linux; Android 14; SM-A245F Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36 Telegram-Android/11.5.0 (Samsung SM-A245F; Android 14; SDK 34; AVERAGE)',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_36.0.0 JsSdk/2.0 NetType/WIFI Channel/App Store ByteLocale/de Region/CH',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Snapchat/13.50.0.0 (like Safari/8618.1.15.10.15, panda)',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [LinkedInApp]/9.31.100',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.10.0',
    'Mozilla/5.0 (Linux; Android 14; SM-A245F Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36 MMWEBID/1234 MicroMessenger/8.0.50.2600(0x28003237) WeChat/arm64 Weixin NetType/WIFI Language/de',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Discord/250.0 (iPhone; iOS 18.6; Scale/3.00)',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Reddit/Version 2025.40.0/Build 600000/iOS Version 18.6 (Build 22G86)',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 25.8.0',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [Pinterest/iOS]',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WhatsApp/2.25.20.1',
    'Mozilla/5.0 (Linux; Android 14; SM-A245F Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36 Viber/24.5.0.0',
    'Mozilla/5.0 (Linux; Android 11; CUBOT X30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Linux; Android 13; Redmi Note 12 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    'Mozilla/5.0 (SMART-TV; LINUX; Tizen 8.0) AppleWebKit/537.36 (KHTML, like Gecko) Version/8.0 TV Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Brave/141',
];
