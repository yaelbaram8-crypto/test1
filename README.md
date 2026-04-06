# Family Shopping App

## Local Configuration (Supabase)

This project loads Supabase settings from a local file named `app-config.js`.

### Setup

1. Copy `app-config.example.js` to `app-config.js`.
2. Edit `app-config.js` and set:
   - `SUPABASE_URL`
   - `SUPABASE_KEY` (publishable key only)
3. Open `index.html` normally.

### Security Notes

- `app-config.js` is ignored by git and should stay local.
- Never put `SUPABASE_SERVICE_ROLE_KEY` in client-side files.
- If a key was previously exposed, rotate it in Supabase.

## Backend/Automation Secrets

For server-side scripts and GitHub Actions, use environment variables/secrets only:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

These are already wired in the workflow file.

## Troubleshooting

- Blank app / data not loading:
   - Verify `app-config.js` exists in the project root.
   - Verify `SUPABASE_URL` and `SUPABASE_KEY` are set correctly.
- 401/403 from Supabase:
   - Confirm you are using a publishable (anon) key in client-side config.
   - Do not use `SUPABASE_SERVICE_ROLE_KEY` in browser files.
- Changes not reflected:
   - Hard refresh the page (Ctrl+F5).
   - If using a service worker, clear site data and reload.
