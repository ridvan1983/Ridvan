# Security checklist — produktion (Ridvan / bolt.new-stack)

Praktisk lista inför och efter launch. Stack: **Cloudflare** (hosting/edge), **Remix**, **Supabase**, **Stripe**, **Anthropic**. Uppdatera dokumentet när ni lägger till nya integrationer eller env-variabler.

---

## 1. Secrets & API-nycklar

### 1.1 Variabler som förekommer i projektet (källa: `env.example` + kod)

| Variabel | Typ | Var den används (kort) |
|----------|-----|-------------------------|
| `ANTHROPIC_API_KEY` | **Hemlig, server** | LLM-anrop (chat, mentor m.m. via `api-key` / routes) |
| `ANTHROPIC_MODEL` | Valfri, server | Override av modell (`app/lib/.server/llm/model.ts`) |
| `VITE_SUPABASE_URL` | **Publik** (byggs in i klient) + server | Supabase-URL; server läser samma namn |
| `VITE_SUPABASE_ANON_KEY` | **Publik** (byggs in) | Klient-Supabase; ska vara **anon**, aldrig service role |
| `SUPABASE_SERVICE_ROLE_KEY` | **Hemlig, server** | `supabaseAdmin` — full DB/auth-rättigheter |
| `STRIPE_SECRET_KEY` | **Hemlig, server** | Stripe API (checkout, webhooks-hantering m.m.) |
| `STRIPE_WEBHOOK_SECRET` | **Hemlig, server** | Signaturverifiering för webhooks |
| `STRIPE_PRICE_ID_STARTER` / `PRO` / `BUSINESS` | Id:n, ej lösenord | Checkout för abonnemang |
| `STRIPE_PRICE_ID_TOPUP_*` (6 st) | Id:n | Engångstopups |
| `VERCEL_TOKEN` | **Hemlig, server** | Vercel deploy / domäner |
| `NETLIFY_TOKEN` | **Hemlig, server** | Netlify deploy (om route används) |
| `ADMIN_SECRET` | **Hemlig, server** | Admin-API + cookie-session för `/admin/*` |
| `DIGEST_CRON_SECRET` | **Hemlig, server** | Skydd av cron-endpoint (`api.digest.send`) |
| `RIDVAN_DEBUG_CHAT` | Valfri | Sätts **inte** till `1` i prod |
| `VITE_DISABLE_PERSISTENCE` | Valfri, byggs in om satt | Stänger IndexedDB-persistens i klient |

**Cloudflare:** alla hemligheter ska ligga som **encrypted env** / **secrets** i Cloudflare (Pages/Workers), inte i git. Lokal utveckling: `.dev.vars` (i `.gitignore`).

### 1.2 Rotation — när och hur

| Secret | Rotera när | Hur (konkret) |
|--------|------------|----------------|
| `ANTHROPIC_API_KEY` | Kvartalsvis, vid läcka, vid personalbyte | Ny nyckel i Anthropic Console → uppdatera Cloudflare → deploy → **invalidera gammal** |
| `SUPABASE_SERVICE_ROLE_KEY` | Vid läcka, misstänkt intrång | Supabase Dashboard → Project Settings → API → **roll key** → uppdatera alla workers/pages som använder den |
| `VITE_SUPABASE_ANON_KEY` | Sällan; vid misstänkt missbruk | Supabase kan rotera JWT secret (påverkar anon); uppdatera build-env och **ombygg** frontend |
| `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` | Vid läcka, regelbunden policy (t.ex. årligen) | Stripe Dashboard → skapa ny secret/webhook signing secret → uppdatera env → **byt webhook URL secret i Stripe** om det är signing secret |
| `STRIPE_PRICE_ID_*` | Vid prisbyte / ny produkt | Uppdatera i Stripe, sedan env; testa checkout i **live** med litet belopp |
| `VERCEL_TOKEN` / `NETLIFY_TOKEN` | Vid läcka, offboarding | Respektive dashboard → revoke token → ny token med **minsta scope** |
| `ADMIN_SECRET` | Före launch (stark!), vid läcka | Generera ny (t.ex. `openssl rand -hex 32`) → Cloudflare → meddela team säkert |
| `DIGEST_CRON_SECRET` | Vid läcka | Ny slumpsträng, uppdatera Cloudflare + cron-jobb som anropar endpointen |

**Ordning vid rotation:** (1) Ny nyckel skapad, (2) sätt i Cloudflare, (3) deploy, (4) verifiera i staging/prod, (5) **revoke gammal** i extern tjänst.

### 1.3 Om en hemlighet läcker

1. **Revoke omedelbart** i källan (Anthropic, Stripe, Supabase, Vercel, Cloudflare).
2. Sätt **ny** secret i Cloudflare och deploya.
3. Granska **loggar** (Cloudflare, Stripe, Supabase) för ovanlig användning samma tidsfönster.
4. Vid Stripe: granska **betalningar och kunder**; vid Supabase: överväg **forced password reset** / session revoke enligt policy.
5. Dokumentera incident (datum, vad som roterats, påverkan).

---

## 2. Supabase

### 2.1 RLS (Row Level Security)

- I repots **SQL-migrationer** finns **inga** uttryckliga `ENABLE ROW LEVEL SECURITY` / policies dokumenterade här.
- **Action:** I Supabase Dashboard → **Table editor** / **Authentication** → verifiera per tabell:
  - **`public.*`** som nås från **klienten med anon key** måste ha RLS som begränsar till `auth.uid()` (eller liknande).
  - Tabeller som **endast** nås via **service role** från er Remix-worker (API routes) kan tekniskt köras utan RLS, men då är **all** åtkomstkontroll i applikationskod — ett fel = dataläcka. **Rekommendation:** RLS även som andra lager där det är rimligt.

**Checklista:** Lista era tabeller (`projects`, `subscriptions`, `credit_ledger`, `mentor_*`, `error_logs`, …) och markera: *RLS på* / *saknas — åtgärd*.

### 2.2 Service role key

- **Var:** `app/lib/supabase/server.ts` — `supabaseAdmin` med `SUPABASE_SERVICE_ROLE_KEY`.
- **Risk:** Full åtkomst till data och Auth admin; får **aldrig** exponeras i browser eller i `VITE_*`.
- **Åtgärder:** Endast server/edge; minska exponering i loggar; rotera vid läcka; begränsa vem som ser Cloudflare secrets.

### 2.3 Auth att kontrollera före launch

- [ ] **Site URL** och **redirect URLs** i Supabase Auth matchar prod-domän(er).
- [ ] **E-postbekräftelse** på/av enligt produktbeslut (påverkar signup-flöden).
- [ ] **JWT expiry** / refresh rimligt för er risknivå.
- [ ] Ingen **service role** i mobilapp/frontend by mistake.

---

## 3. Stripe

### 3.1 Webhook-signatur

- Kod: `app/routes/api.stripe.webhook.ts` — `stripe.webhooks.constructEvent` med `STRIPE_WEBHOOK_SECRET`.
- **Prod:** Webhook endpoint i Stripe Dashboard pekar på **live** URL; **egen** signing secret för den endpointen (inte test-secret i prod).
- **Check:** Returnera `400` vid fel signatur — acceptera aldrig payload utan verifiering.

### 3.2 Test vs live

- [ ] **Live**-nycklar och **live** price IDs endast i prod-env.
- [ ] Separata webhook endpoints eller secrets för test/staging om ni har det.
- [ ] Efter deploy: en **riktig** liten testtransaktion eller Stripe test mode på staging separat från live.

### 3.3 Misstänkt bedrägeri

1. Stripe Dashboard → **Payments** / **Radar** — spärra/refundera enligt policy.
2. Sök efter **samma kund / e-post / kort** i user base.
3. Vid dataintrång: rotera secrets, granska **metadata** på checkout sessions (userId).
4. Dokumentera och ev. polisanmälan enligt bolagets rutin.

---

## 4. Anthropic API

### 4.1 Rate limiting (i er app)

- **Chat:** `app/routes/api.chat.ts` + `app/lib/security/rate-limiter.ts` (svar med bl.a. `X-RateLimit-*`).
- **Distribuerat:** `app/lib/security/distributed-rate-limit.server.ts` — bl.a. mentor, auth (`login`), deploy (Vercel).
- **Check:** Verifiera att Cloudflare KV / binding som rate limitern förlitar sig på är **aktiverad** i prod (annars kan limiter falla tillbaka eller misslyckas — se implementation).

### 4.2 Kostnadskontroll

- [ ] **Credits / billing** i produkten begränsar användning (ni har bl.a. subscription + ledger).
- [ ] I **Anthropic Console:** sätt **spend limits** / alerts om tillgängligt.
- [ ] Övervaka anomala spikes (samma userId, samma IP massvis anrop).

### 4.3 Läckt API-nyckel

1. Revoke i Anthropic omedelbart.
2. Ny nyckel i Cloudflare → deploy.
3. Granska användningshistorik i Anthropic för **obehörig** användning.

---

## 5. Cloudflare

### 5.1 Deploy & tokens

- **Git-integration:** Begränsa vem som kan merge till prod-branch; 2FA på Cloudflare/GitHub.
- **API tokens** (om ni deployar via CI): minimal scope (endast Pages/Workers som behövs), kort livslängd där det går.
- **Separata** Cloudflare-projekt för staging vs prod om möjligt.

### 5.2 Vad som är publikt

- Allt som börjar med **`VITE_`** kan hamna i **klientbundle** — räkna med att användare kan se det.
- **Inte publikt:** `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `ANTHROPIC_API_KEY`, `ADMIN_SECRET`, `VERCEL_TOKEN`, webhook secrets, `DIGEST_CRON_SECRET`.

### 5.3 Headers (nuvarande läge + förbättringar)

- I `app/entry.server.tsx` sätts bl.a. `Cross-Origin-Embedder-Policy: credentialless`, `Cross-Origin-Opener-Policy: same-origin`.
- **Innan launch — överväg att lägga till (via Cloudflare Transform Rules eller Remix headers):**
  - [ ] **HSTS** (`Strict-Transport-Security`) på apex och www.
  - [ ] **CSP** (Content-Security-Policy) anpassad efter era scripts (Unsplash, fonts, Stripe.js om ni laddar det, osv.).
  - [ ] `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy` enligt behov.
- **Cookies:** Admin-cookie är **HttpOnly** + **SameSite=Lax** (se `admin-auth.server.ts`) — bra; säkerställ **Secure** i prod (HTTPS).

---

## 6. Innan launch — checklista i ordning

Gör i ungefär denna ordning så ni inte lämnar “halva” säkerhetslager.

1. [ ] **Inga secrets i git** — sök `rg -i "sk_|api_key|secret" --glob '!node_modules'` och granska träffar.
2. [ ] **Cloudflare prod-env** komplett och matchar `env.example` + eventuella extra variabler (ADMIN, VERCEL, DIGEST, …).
3. [ ] **`VITE_*`** innehåller bara **publik** data; **aldrig** service role.
4. [ ] **Supabase:** RLS-genomgång för tabeller som exponeras mot anon; service role endast server.
5. [ ] **Stripe live:** webhook URL + **live** signing secret; testköp / test-refund enligt rutin.
6. [ ] **Anthropic:** spend limit / alert; roterad prod-nyckel som inte använts i dev.
7. [ ] **ADMIN_SECRET:** stark, unik för prod; admin-URL inte länkad publikt om ni vill “security through obscurity” (ersätter inte auth).
8. [ ] **Rate limits** och KV/bindings verifierade i prod.
9. [ ] **Headers:** HSTS + CSP (minst granskat).
10. [ ] **Backup / återställning:** Supabase backups påslagna; vet vem som kan återställa.
11. [ ] **Incident:** skriv ner vem som roterar nycklar och var loggar finns (Cloudflare, Stripe, Supabase).

---

*Senast uppdaterad: skapad för produktionslansering — uppdatera vid arkitekturändringar.*
