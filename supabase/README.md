# Supabase setup — Family Planner

**Use a dedicated Supabase project for this app. Do not use the My Garage database.**

## Security model

- The web app must use only the project's publishable key in the browser. Never put a secret/service-role key in frontend code or GitHub.
- All rows are owned by the authenticated Supabase user and protected by row-level security (RLS).
- Anonymous access is not granted. Disable public sign-ups and create the spouse's account explicitly in Supabase Auth.
- Use a strong password or email OTP/magic link and configure the production site URL plus allowed redirect URLs.
- Treat calendar notes, clinic visits, pregnancy dates and payments as sensitive personal data.
- Browser localStorage in the current prototype is not cloud sync and is not a secure shared backup.

## Database

Run `schema.sql` in the SQL Editor of the dedicated project. The script creates the tables, indexes, update triggers, explicit API grants and per-user RLS policies.

After applying it, inspect Database → Tables and run the Supabase Security Advisor. Do not add any policy for `anon`.

## Before enabling cloud sync

1. Create a separate Supabase project for Family Planner.
2. Disable sign-ups; create only the intended user's account.
3. Set the production Site URL and exact redirect URLs in Auth settings.
4. Add the project's URL and publishable key to the frontend configuration using the deployment provider's environment/configuration mechanism.
5. Implement and test sign-in, sign-out, session restore, loading/error states and migration from local-only data.
6. Test that user A cannot read or modify user B's rows.
7. Keep the repository private before storing private configuration or real user data.

## Notifications

Do not rely on an iPhone PWA running in the background for reliable reminders. Scheduled reminders should be sent by a server-side scheduled function and delivered via Telegram and/or Web Push. Store bot tokens and VAPID private keys only in server-side secrets. Notification text should avoid exposing medical, pregnancy or payment details on a locked screen.

## Current status

The current app is still local-first. This schema is the security foundation, not proof that cloud sync or notifications are already connected. The frontend must not claim a cloud save until the authenticated database round-trip succeeds.
