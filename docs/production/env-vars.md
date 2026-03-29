# Production Environment Variables

| Variable | Required | Used for | How to create it |
| --- | --- | --- | --- |
| `ANTHROPIC_API_KEY` | Yes | AI model access for generation and business intelligence features | Create an API key in the Anthropic dashboard and copy it into your deployment environment. |
| `VITE_SUPABASE_URL` | Yes | Client-side Supabase project URL | In Supabase Dashboard, open Project Settings and copy the project URL. |
| `VITE_SUPABASE_ANON_KEY` | Yes | Client-side Supabase anonymous key | In Supabase Dashboard, open Project Settings > API and copy the anon/public key. |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-side privileged Supabase access | In Supabase Dashboard, open Project Settings > API and copy the service role key. Keep it server-only. |
| `STRIPE_SECRET_KEY` | Yes | Server-side Stripe API access for checkout and billing | In Stripe Dashboard, open Developers > API keys and copy the secret key. |
| `STRIPE_WEBHOOK_SECRET` | Yes | Verification of incoming Stripe webhook signatures | In Stripe Dashboard, open the webhook endpoint and copy the signing secret for that endpoint. |
| `UPSTASH_REDIS_REST_URL` | Yes | Server-side Upstash Redis REST endpoint used for distributed rate limiting | Create a Redis database in Upstash and copy the REST URL from the database details page. |
| `UPSTASH_REDIS_REST_TOKEN` | Yes | Server-side Upstash Redis REST token used for distributed rate limiting | Copy the REST token from the same Upstash database details page and keep it server-only. |
| `ADMIN_SECRET` | No | Bearer secret for internal admin routes such as billing reconciliation | Generate a long random secret locally or with a password manager and store it only in trusted environments. |

## Setup steps

1. Create or open your Supabase project.
2. Copy the project URL, anon key, and service role key from Supabase Dashboard.
3. Create or open your Stripe account.
4. Copy the Stripe secret key from the API keys page.
5. Create a Stripe webhook endpoint for your app and copy its signing secret.
6. Create a Redis database in Upstash and copy its REST URL and REST token.
7. Create an Anthropic API key from the Anthropic dashboard.
8. Optionally generate an `ADMIN_SECRET` for protected internal admin routes.
9. Add all values to your local `.env` and your production deployment environment.

## Notes

- Never expose `SUPABASE_SERVICE_ROLE_KEY` in client-side code.
- Never expose `UPSTASH_REDIS_REST_TOKEN` in client-side code.
- Never commit real secrets to git.
- `VITE_` variables are exposed to the frontend and must only contain safe public values.
- `ADMIN_SECRET` should only be shared with trusted operators and never exposed in frontend code.
