# anti-ai – KI-Crawler, KI-Assistenten und Scraper aussperren

Ein wiederverwendbarer Baustein für Websites und Web-Apps: Menschen im Browser bekommen alles, Suchmaschinen und Link-Vorschauen höchstens eine kurze Infoseite, KI-Crawler, KI-Assistenten, Skripte und automatisierte Browser nichts (403). Läuft auf **nginx** (eigener Server, Docker) und auf **Vercel** (Routing Middleware) mit derselben Entscheidung; nginx bekommt die Entscheidungstabelle generiert, damit beide nie auseinanderlaufen.

## Was wer bekommt

| Wer | Erkennung | App, Code, Bilder, Daten | Infoseite (`infoPath`) | robots.txt, ai.txt, tdmrep.json |
| --- | --- | --- | --- | --- |
| Mensch im Browser | alles andere | ja | ja | ja |
| Browser ohne `Accept-Language` bei Seitenaufrufen | Kopfzeilen | Seiten: 403 · Dateien: ja | 403 | ja |
| KI-Crawler, -Assistenten, -Agenten | Name im User-Agent (`data/ai-robots.json` + `data/agents.json`) oder Web-Bot-Auth-Signatur | 403 | 403 (`ai: "deny"`) | ja |
| Skripte, HTTP-Bibliotheken, Headless-/Testbrowser, Website-Kopierer, Scanner | User-Agent | 403 | 403 | ja |
| Unbekannte Bots, leerer User-Agent | `…bot/1.0`, `compatible; …crawler` | 403 | 403 | ja |
| Suchmaschinen | User-Agent | 403 | ja (`search: "info"`) | ja |
| Link-Vorschau (WhatsApp, Telegram, Discord …) | User-Agent | Seiten → Infoseite, sonst 403 | ja (`previews: "info"`) | ja |
| Jeder, der dem versteckten Fallen-Link folgt | Pfad `trapPath` | 403 und Sperre per fail2ban (nginx) | – | – |

Dazu überall: `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet, noimageindex, notranslate, noai, noimageai` (Infoseite nur `noarchive, noai, noimageai`), `tdm-reservation: 1` (W3C TDMRep, Vorbehalt nach Art. 4 Abs. 3 der EU-Richtlinie 2019/790), `robots.txt` mit `Content-Signal: search=…, ai-input=no, ai-train=no`, `ai.txt` (Spawning). Seitenaufrufe sind je Adresse begrenzt (nginx), Dateien nicht.

## Ehrliche Grenzen

- **robots.txt, ai.txt, TDMRep und Meta-Angaben sind Bitten.** Die grossen Anbieter halten sich daran, viele andere nicht. Deshalb setzt der Server sie durch.
- **Der User-Agent ist frei wählbar.** Wer sich als normales Chrome ausgibt und alle Kopfzeilen eines Browsers schickt, kommt durch. Dagegen helfen nur die Falle (fail2ban), Ratenbegrenzung und eine Plattform-Bot-Erkennung (Vercel BotID / Bot Protection, Cloudflare). Ein KI-Agent, der einen echten Browser für einen Menschen bedient, ist nicht sicher von diesem Menschen zu unterscheiden – es sei denn, er signiert sich (Web Bot Auth, z. B. ChatGPT Agent): solche Anfragen sperrt der Baustein.
- **Was ein Browser bekommt, ist öffentlich.** JavaScript, CSS und Bilder einer Web-App liegen nach dem Laden auf dem Gerät. Wirklich geschützt ist nur, was hinter einer Anmeldung liegt oder gar nicht ausgeliefert wird.
- **Öffentliche Git-Repositories** sind für jeden lesbar – auch für KI-Crawler und Datensätze. Code, Ideen und Design schützt dort nur ein privates Repository.
- Eine Sperre per fail2ban trifft eine IP-Adresse. Im Mobilfunk teilen sich oft viele Menschen eine Adresse (Carrier-NAT); deshalb sperrt nur die Falle (nie ein Mensch), die Sperre wegen wiederholter Ablehnung ist aus.
- Rechtliches ist hier nur technisch umgesetzt (maschinenlesbarer Vorbehalt, Hinweis auf der Infoseite); das ist keine Rechtsberatung.

## In ein Projekt einbauen

1. Ordner `anti-ai/` ins Projekt kopieren (keine Abhängigkeiten ausser Node ≥ 22; für Vercel `@vercel/functions`).
2. `anti-ai.site.json` anlegen (Beispiel: die von AS-TAC im Repo-Wurzelordner):

   | Feld | Bedeutung |
   | --- | --- |
   | `name`, `origin` | Name und Adresse der Website |
   | `infoPath`, `infoAssets` | öffentliche Infoseite (Ordner mit `index.html`) und was sie lädt (Icon) |
   | `trapPath` | Fallen-Pfad, z. B. `/_/k7v2q9/` (nur Buchstaben, Ziffern, `-`, `_`) |
   | `search`, `previews`, `ai` | `"info"` (nur Infoseite) oder `"deny"` (403) |
   | `requireAcceptLanguage` | Seitenaufrufe ohne `Accept-Language` ablehnen (Standard: ja) |
   | `allowUserAgents` | Ausnahmen, z. B. ein Überwachungsdienst (Achtung: jeder kann diesen Namen vorgeben) |
   | `rateLimit` | Seitenaufrufe je Adresse und Sekunde, `burst` (nginx) |
   | `trustedProxies` | Adressen vorgeschalteter Proxys, deren `X-Forwarded-For` gilt (nginx) |
   | `nginx.logFile`, `nginx.accessLog`, `nginx.headersInclude` | Pfade im nginx-Container |
   | `ban` | fail2ban: Minuten, Kette (`DOCKER-USER` bei Docker, sonst `INPUT`), Log-Pfad auf dem Host, `denyJail` |
   | `outputs` | wohin welche Datei geschrieben wird (weglassen, was nicht gebraucht wird) |

3. `node anti-ai/bin/anti-ai.mjs build` erzeugt die Dateien; `… check` prüft, ob sie aktuell sind (für CI).
4. In die Seiten: die Meta-Angaben und den Fallen-Link (Vorlage: Ausgabe `meta`), eine Infoseite mit `noarchive, noai, noimageai`.

### nginx (eigener Server, Docker)

- `http.conf` in den http-Kontext (z. B. `conf.d/00-anti-ai.conf`), `server.conf` per `include` in den `server`-Block vor die `location`s, `headers.conf` in jede `location` mit eigenem `add_header` (nginx erbt sonst nichts).
- Log-Ordner (`/var/log/nginx/anti-ai/`) auf den Host binden, z. B. `docker run -v /var/log/as-tac:/var/log/nginx/anti-ai …`.
- fail2ban auf dem Host: Filter nach `/etc/fail2ban/filter.d/`, Jail nach `/etc/fail2ban/jail.d/`, `systemctl reload fail2ban`. Prüfen: `fail2ban-client status anti-ai-trap`.
- Liegt ein Proxy davor (Caddy, Traefik, Load Balancer), seine Adressen in `trustedProxies`; hinter Cloudflare dessen Adressbereiche – sonst trifft die Ratenbegrenzung alle gemeinsam. Ein CDN davor darf Antworten nicht für alle zwischenspeichern, ohne dieselbe Prüfung zu machen (sonst bekommt ein Bot die Kopie, die ein Mensch ausgelöst hat).

### Vercel

- `proxy.js` im Projekt (Ausgabe `vercelPolicy` z. B. auf `anti-ai.policy.mjs`; `package.json` mit `"type": "module"`):
  ```js
  import { createProxy } from './anti-ai/lib/vercel.mjs';
  import policy from './anti-ai.policy.mjs';
  export default createProxy(policy);
  ```
  und in `vercel.json`: `"proxy": { "entrypoint": "proxy.js" }` (Vercel nimmt nur `.js`, `.ts` oder `.py`). Vercel führt die Datei als natives Node-ESM aus, ohne zu bündeln: kein JSON-Import (Node verlangt dafür `with { type: 'json' }`), relative Importe mit Endung (nicht mit Frameworks, die eigene Middleware bauen, z. B. Next.js oder Astro – dort deren Datei verwenden). Läuft vor Vercels Cache bei jeder Anfrage.
- Zusätzlich die verwalteten Firewall-Regeln von Vercel einschalten (alle Pläne, standardmässig aus); sie prüfen Bots auch über IP-Bereiche, Reverse-DNS und Signaturen:
  - **AI Bots:** Dashboard → Security → Firewall → Rules → Bot Management → AI Bots, für «AI crawlers» und «AI assistants» je **Deny**. Per CLI z. B. `vercel firewall rules edit ai-bots --category ai-crawlers --action deny --yes`, dann `vercel firewall diff` und `vercel firewall publish`.
  - **Bot Protection:** stellt Clients, die sich nicht wie ein Browser verhalten (z. B. `curl` mit Chrome-Namen), eine JavaScript-Prüfung. Zuerst auf **Log**, nach Durchsicht auf **Challenge**. Wirkt nicht, wenn ein weiterer Proxy (Cloudflare) vor Vercel steht.
  - Ratenbegrenzung über eine eigene Firewall-Regel (Rate Limiting).

## Pflege

- Neue KI-Crawler: `node anti-ai/bin/anti-ai.mjs update-list` (holt die Liste von [ai.robots.txt](https://github.com/ai-robots-txt/ai.robots.txt), MIT), danach `build`. Eigene Ergänzungen in `data/agents.json`.
- Tests: `node --test "anti-ai/test/*.test.mjs"` – jede Art von Client auf jeder Art von Pfad gegen die Entscheidung, den Vercel-Proxy und (wenn installiert) ein echtes nginx mit der erzeugten Konfiguration, dazu fail2ban-Filter und Ratenbegrenzung.
