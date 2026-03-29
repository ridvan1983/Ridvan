## Pre-launch checklist

### API Keys & Secrets
- [ ] ANTHROPIC_API_KEY roterad och ej exponerad i loggar
- [ ] STRIPE_SECRET_KEY är live-nyckel (ej test)
- [ ] STRIPE_WEBHOOK_SECRET är satt för live webhook endpoint
- [ ] SUPABASE_SERVICE_ROLE_KEY är säkrad
- [ ] ADMIN_SECRET är ett starkt random värde (min 32 tecken)
- [ ] UPSTASH_REDIS_REST_TOKEN är satt
- [ ] VERCEL_TOKEN och NETLIFY_TOKEN är satta
- [ ] SUPABASE_CLIENT_SECRET för OAuth är satt

### Stripe
- [ ] Webhook endpoint är registrerad för produktionsdomän
- [ ] Webhook events: checkout.session.completed, invoice.paid, customer.subscription.deleted
- [ ] Test mode är avstängt
- [ ] Pricing plans matchar databasens plan-namn

### Supabase
- [ ] RLS (Row Level Security) är aktiverat på alla tabeller
- [ ] Service role key används ALDRIG på klientsidan
- [ ] Auth redirect URLs inkluderar produktionsdomän
- [ ] Supabase OAuth redirect URL är uppdaterad för produktion

### Rate Limiting
- [ ] Upstash Redis är konfigurerat för produktion
- [ ] Rate limits är testade och rimliga för användare

### Deployment
- [ ] VERCEL_TOKEN har rätt scopes
- [ ] Netlify token är satt som fallback
- [ ] SPA rewrites (vercel.json) injiceras automatiskt

### Monitoring
- [ ] Error monitoring är aktivt (Sentry/Logtail DSN satt)
- [ ] Admin dashboard är tillgänglig på /admin
- [ ] Webhook failures är övervakade

### Legal
- [ ] Privacy policy är publicerad
- [ ] Terms of service är publicerade
- [ ] GDPR-compliance är dokumenterad
