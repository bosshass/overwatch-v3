# Overwatch V3 — DRH Security Field Dashboard

Calendar-only read dashboard. No database. No Supabase.

## What it does
- Reads DRH Google Calendars (Service Queue, Austin, JR, Installations, etc.)
- Tech view: field techs see their assigned jobs for today/this week
- Owner view: JR sees all calendars, pipeline counts, everything at a glance
- Operator (Sara): can switch between both views

## Stack
- React + Vite
- Google Calendar API (read-only)
- Google OAuth for auth
- Deployed to Vercel → overwatch.highsidesecurity.com

## Env vars
```
VITE_GOOGLE_CLIENT_ID=your-google-client-id
```

## Deploy
```bash
npm install
npm run build
npx vercel --prod
```
