# PROJECT BIBLE – AI Builder Platform
Senast uppdaterad: 2026-03-31

## Vad vi bygger
Konkurrent till Lovable.dev – AI-driven fullstack app builder
med inbyggd AI-mentor (VD, CFO, CMO, HR, Legal, sälj).

## Status
- Prompt 1 ✅ Env-lagret klart – app/lib/env.server.ts skapad
- Prompt 2 ✅ Feature flags + mentor refactor klart – commit 820ed67
- Prompt 3 ✅ Golden Path E2E KLAR

## Stack
React 18, Remix 2, Cloudflare Workers/Pages, WebContainers,
Supabase (DB + Auth), Anthropic Claude API, Stripe, Upstash Redis

## Regler
- Rör inte core-filer utan explicit tillstånd
- Kör pnpm typecheck efter varje steg
- Rapportera vad du hittat och fixat per steg
- Fråga mig om du är osäker

## Golden Path – verifiera och fixa:

STEG 1 - AUTH
- Registrering med email fungerar
- Login fungerar
- Logout fungerar
- Redirect till rätt sida efter login

STEG 2 - PROJEKT
- Skapa nytt projekt fungerar
- Projektlistan visas korrekt
- Projekt sparas i databasen

STEG 3 - BUILDER
- Prompt → kodgenerering fungerar
- Live preview visas
- Iterera via chat fungerar
- Filer sparas korrekt

STEG 4 - MENTOR
- Mentor har tillgång till projektkontext
- Brain/minne fungerar mellan sessioner
- Credits dras korrekt

STEG 5 - DEPLOY
- Vercel-deploy fungerar
- Preview URL sparas på projektet
- Användaren ser publicerad URL

STEG 6 - BILLING
- Stripe checkout öppnas
- Webhook tar emot betalning
- Credits uppdateras efter köp

## Nästa öppna punkt
- OutOfCreditsModal: verifiera och härda checkout-/redirect-flöde end-to-end
