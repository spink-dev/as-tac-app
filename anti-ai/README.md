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
| Link-Vorschau (WhatsApp, Telegram, Discord, Facebook/Messenger/iMessage über `facebookexternalhit` …) | User-Agent ohne Browser-Engine | Seiten → Infoseite, sonst 403 | ja (`previews: "info"`) | ja |
| Jeder, der dem versteckten Fallen-Link folgt | Pfad `trapPath` | 403 und Sperre per fail2ban (nginx) | – | – |

Dazu überall: `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet, noimageindex, notranslate, noai, noimageai` (Infoseite nur `noarchive, noai, noimageai`), `tdm-reservation: 1` (TDMRep, Bericht einer W3C Community Group; maschinenlesbarer Vorbehalt im Sinn von Art. 4 Abs. 3 der EU-Richtlinie 2019/790), `robots.txt` mit `Content-Signal: search=…, ai-input=no, ai-train=no`, `ai.txt` (Spawning), auf Seiten `Vary: User-Agent, Accept-Language`. Seitenaufrufe sind je Adresse begrenzt (nginx), Dateien nicht; ein neues Gerät braucht etwa drei Seitenaufrufe (Seite und Service-Worker-Cache), `burst` entsprechend gross wählen.

In-App-Browser von Messengern (WhatsApp, Instagram, Facebook, Telegram, Viber …) nennen eine Browser-Engine und gelten als Menschen; nur Abrufer ohne Engine sind Link-Vorschauen – ausser `facebookexternalhit`/`Facebot` (Facebook, Messenger und die iMessage-Vorschau von Apple, die sich zugleich als Safari ausgibt): die bekommen immer nur die Infoseite. Namen, die gewöhnlichen Browser-Bestandteilen entsprechen (`Mobile`, `Version`, `wv` …), und Namen unter vier Zeichen aus der übernommenen Liste werden nie verglichen – ein unglücklicher Eintrag dort kann so keine Telefone aussperren (die eigenen Listen dürfen kurze Namen wie `Bun` oder `PHP` enthalten). Allgemeine Wörter der Liste (`Code`, `Cursor`, `Operator` …) treffen nur ganze Wörter; der eingebaute Browser von VS Code gilt damit als KI-Werkzeug. Die Tests prüfen über 40 echte Browser- und In-App-User-Agents.

## Ehrliche Grenzen

- **robots.txt, ai.txt, TDMRep und Meta-Angaben sind Bitten.** Die grossen Anbieter halten sich daran, viele andere nicht. Deshalb setzt der Server sie durch.
- **Der User-Agent ist frei wählbar.** Wer sich als normales Chrome ausgibt und alle Kopfzeilen eines Browsers schickt, kommt durch. Dagegen helfen nur die Falle (fail2ban) und eine Plattform-Bot-Erkennung (Vercel BotID / Bot Protection, Cloudflare); die Ratenbegrenzung bremst lediglich das massenhafte Abrufen von Seiten. Ein KI-Agent, der einen echten Browser für einen Menschen bedient, ist nicht sicher von diesem Menschen zu unterscheiden – es sei denn, er signiert sich (Web Bot Auth, z. B. ChatGPT Agent): solche Anfragen sperrt der Baustein.
- **Was ein Browser bekommt, ist öffentlich.** JavaScript, CSS und Bilder einer Web-App liegen nach dem Laden auf dem Gerät. Wirklich geschützt ist nur, was hinter einer Anmeldung liegt oder gar nicht ausgeliefert wird.
- **Öffentliche Git-Repositories** sind für jeden lesbar – auch für KI-Crawler und Datensätze. Code, Ideen und Design schützt dort nur ein privates Repository.
- **Eine Sperre per fail2ban trifft eine IP-Adresse – und damit alle, die sie teilen.** Im Mobilfunk teilen sich oft viele Menschen eine Adresse (Carrier-NAT, iCloud Private Relay, ein LTE-Router am Spielfeld). Deshalb sperrt standardmässig nur die Falle (die ein Mensch nicht auslöst, ein Bot aber für alle hinter derselben Adresse) und nur kurz (15 Minuten); die Sperre wegen wiederholter Ablehnung ist aus. Private Adressen werden nie gesperrt.
- fail2ban wirkt nur, wenn im Log die echte Adresse steht und die Sperre dort greift, wo die Verbindungen ankommen (siehe «nginx»). Hinter Cloudflare sperrt iptables nichts Sinnvolles.
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
   | `rateLimit` | Seitenaufrufe (Navigationen) je Adresse und Sekunde, `burst` (nginx) |
   | `trustedProxies` | genaue Adressen vorgeschalteter Proxys, deren `X-Forwarded-For` gilt (nginx); nie ganze private Bereiche |
   | `nginx.logFile`, `nginx.accessLog`, `nginx.accessLogFormat`, `nginx.headersInclude` | Pfade und Log-Format im nginx-Container; `headersInclude` für die 403-Antwort (am besten die Datei mit allen Sicherheits-Headern) |
   | `ban` | fail2ban: Minuten, Kette (`INPUT` oder `DOCKER-USER`), Log-Pfad auf dem Host, `denyJail` |
   | `outputs` | wohin welche Datei geschrieben wird (weglassen, was nicht gebraucht wird) |

3. `node anti-ai/bin/anti-ai.mjs build` erzeugt die Dateien; `… check` prüft, ob sie aktuell sind (für CI).
4. In die Seiten: die Meta-Angaben und den Fallen-Link (Vorlage: Ausgabe `meta`), eine Infoseite mit `noarchive, noai, noimageai`.

### nginx (eigener Server, Docker)

- `http.conf` in den http-Kontext (z. B. `conf.d/00-anti-ai.conf`), `server.conf` per `include` in den `server`-Block vor die `location`s, `headers.conf` in jede `location` mit eigenem `add_header` (nginx erbt sonst nichts).
- Eine Infoseite ohne Rückfall auf die App: `location /about/ { …; try_files $uri $uri/ =404; }` (sonst bekommen Suchmaschinen für `/about/irgendwas` die App-Hülle).
- Log-Ordner (`/var/log/nginx/anti-ai/`) auf den Host binden, z. B. `docker run -v /var/log/as-tac:/var/log/nginx/anti-ai …`, und die erzeugte logrotate-Datei nach `/etc/logrotate.d/` (abgelehnte Anfragen werden protokolliert, aber nicht gebremst).
- **Wie die Verbindungen ankommen**, entscheidet über `trustedProxies` und die fail2ban-Kette:
  - *Proxy auf dem Host* (Caddy, Traefik, nginx mit TLS – bei `.dev`-Adressen immer nötig, HSTS): Container nur lokal veröffentlichen (`-p 127.0.0.1:8080:80`), `trustedProxies` auf die Adresse, von der der Proxy im Container ankommt (meist das Docker-Gateway, z. B. `172.17.0.1`; im Log sichtbar), Proxy setzt `X-Forwarded-For`; Kette `INPUT`.
  - *Container direkt im Internet*: `trustedProxies` leer, Kette `DOCKER-USER`.
  - *Cloudflare davor*: dessen Adressbereiche als `trustedProxies` und `real_ip_header CF-Connecting-IP` (von Hand), Sperren über Cloudflare statt fail2ban; dort auch «Block AI bots» einschalten. Ein CDN darf Antworten nicht für alle zwischenspeichern, ohne dieselbe Prüfung zu machen.
  - Nie ganze private Bereiche vertrauen: wer den Container von einer solchen Adresse erreicht (z. B. über IPv6 und docker-proxy), bestimmt sonst seine eigene Adresse – und damit, wen die Falle sperrt.
- fail2ban auf dem Host: Filter nach `/etc/fail2ban/filter.d/`, Jail nach `/etc/fail2ban/jail.d/`, `systemctl reload fail2ban`. Prüfen: `fail2ban-regex /var/log/as-tac/anti-ai.log /etc/fail2ban/filter.d/anti-ai-trap.conf` und `fail2ban-client status anti-ai-trap`.

### Vercel

- `proxy.js` im Projekt (Ausgabe `vercelPolicy` z. B. auf `anti-ai.policy.mjs`; `package.json` mit `"type": "module"`):
  ```js
  import { createProxy } from './anti-ai/lib/vercel.mjs';
  import policy from './anti-ai.policy.mjs';
  export default createProxy(policy);
  ```
  und in `vercel.json`: `"proxy": { "entrypoint": "proxy.js" }` (Vercel nimmt nur `.js`, `.ts` oder `.py`). Vercel führt die Datei als natives Node-ESM aus, ohne zu bündeln: kein JSON-Import (Node verlangt dafür `with { type: 'json' }`), relative Importe mit Endung (nicht mit Frameworks, die eigene Middleware bauen, z. B. Next.js oder Astro – dort deren Datei verwenden). Läuft vor Vercels Cache bei jeder Anfrage.
- Zusätzlich die verwalteten Firewall-Regeln von Vercel einschalten (alle Pläne, standardmässig aus); sie prüfen Bots auch über IP-Bereiche, Reverse-DNS und Signaturen:
  - **AI Bots:** Dashboard → Security → Firewall → Rules → Bot Management → AI Bots, für «AI crawlers» und «AI assistants» je **Deny**, dann veröffentlichen (per CLI: `vercel firewall --help`).
  - **Bot Protection:** stellt Clients, die sich nicht wie ein Browser verhalten (z. B. `curl` mit Chrome-Namen), eine JavaScript-Prüfung. Zuerst auf **Log**, nach Durchsicht auf **Challenge**. Wirkt nicht, wenn ein weiterer Proxy (Cloudflare) vor Vercel steht.
  - Ratenbegrenzung über eine eigene Firewall-Regel (Rate Limiting).

## Pflege

- Neue KI-Crawler: `node anti-ai/bin/anti-ai.mjs update-list` (holt die Liste von [ai.robots.txt](https://github.com/ai-robots-txt/ai.robots.txt), MIT), danach `build`. Eigene Ergänzungen in `data/agents.json`.
- Tests: `node --test "anti-ai/test/*.test.mjs"` – jede Art von Client auf jeder Art von Pfad gegen die Entscheidung, über 40 echte Browser-User-Agents, den Vercel-Proxy (auch so geladen, wie Vercel ihn ausführt) und, wenn installiert, ein echtes nginx mit der erzeugten Konfiguration (Ratenbegrenzung, Weiterleitungen, `X-Forwarded-For`) sowie das echte `fail2ban-regex` mit den erzeugten Filtern. Ohne nginx oder fail2ban werden diese Teile übersprungen (in der Ausgabe als «skipped»).
