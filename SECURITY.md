# Security policy

This app is intended for one family and may contain sensitive health, appointment and financial details.

- Do not enter real personal data into a public demo.
- Keep the repository private before production use.
- Never commit Supabase secret/service-role keys, Telegram bot tokens, VAPID private keys, passwords or recovery codes.
- The browser may contain only a Supabase publishable key; authorization must be enforced by Supabase Auth and row-level security.
- Disable public account registration and provision only the intended user.
- Report a suspected secret leak by rotating the exposed credential immediately and reviewing access logs.
