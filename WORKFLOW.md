1. KONTROLLERAD ÄNDRING I ORIGINALFILER ÄR TILLÅTEN

- Små, tydligt avgränsade ändringar i befintliga filer är tillåtna när:
  - Stubbar måste ersättas med riktig implementation
  - Integration kräver wiring (providers, hooks, routing, guards)
  - En faktisk bugg måste fixas
- Inga stora refactors utan explicit beslut.
- Inga strukturella omorganisationer av kärnarkitektur utan plan.
- Alla ändringar ska vara minimala och lokala.
- Ändra aldrig mer än vad som krävs för att lösa problemet.

2. INGA HEMLIGHETER ELLER TENANT-SPECIFIKA VÄRDEN FÅR HÅRDKODAS

- API-nycklar, tokens, Stripe keys, Supabase keys -> alltid .env
- Ingen service-role key i frontend.
- Inga kundspecifika ID:n i kod.

TILLÅTET:
- Guardrails (max attempts, cooldowns, limits)
- Systemkonstanter
- Default-konfigurationer

Så länge:
- De är dokumenterade
- De är generiska
- De inte är hemligheter

7. STUBBAR SKA ERSÄTTAS MED RIKTIG LOGIK

- Om stubbar upptäcks ska de ersättas med fungerande implementation.
- Inga placeholder-funktioner får ligga kvar i produktion.
- Mock är tillåtet endast bakom tydlig DEV-flag.
- Varje stub som ersätts ska testas direkt.

8. ALLA ÄNDRINGAR SKA VARA REPO-SÄKRA

Efter varje ändring:
- pnpm run dev startar
- Inga TypeScript-fel
- Preview fungerar
- AI fungerar
- Inga nya console errors

Om något bryts -> revert eller isolera direkt.
