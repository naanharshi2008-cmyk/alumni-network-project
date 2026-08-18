# Veveaham Alumni Network

A record of where Veveaham students went after school — which colleges they got
into, how they got in, and what they are doing now — so current students, parents
and the public can see real paths and aim at them.

- **Directory** — every approved alumnus, grouped by batch and school.
- **College Explorer** — the colleges Veveaham seniors actually attend, with the
  rank or marks each of them got in with, plus their advice.
- **Registration** — a five-step form; profiles go live only after staff approval.
- **Admin dashboard** — approve registrations, review profile edits before they
  publish, and curate the dropdown lists so they grow verified instead of messy.

## Tech stack

| | |
|---|---|
| Framework | Next.js (App Router) + TypeScript |
| Database, auth, storage | Supabase (PostgreSQL) |
| Styling | Custom CSS design system (`app/globals.css`) |
| Email | Resend (optional) |
| Hosting | Vercel |

## Running it locally

```bash
npm install
cp .env.local.example .env.local   # then fill in your Supabase values
npm run dev
```

`npm run typecheck` type-checks without building; `npm run build` produces the
production build Vercel runs.

## Database setup

Migrations live in SQL files at the repo root, applied by pasting them into the
Supabase SQL editor:

- `schema.sql` — the original tables, RLS policies and the `higher_studies` /
  `work_experience` tables.
- `migrations/01_additive.sql` — **run this before deploying the current code.**
  Adds the `public_alumni` view the site reads from, edit-staging, the moderated
  options queue, the `organizations` table, and the school-name migration.
  Everything in it is additive, so the currently-live site keeps working.
- `migrations/02_lockdown.sql` — **run this only after the new code is live.**
  Revokes anonymous access to the raw `alumni` table, which is what actually
  closes the leak. Running it early would break the deployed site, because the
  old code reads that table directly.

Both files end with verification queries. After the second one, run
`npm run verify:security` and confirm every check passes.

### How privacy is enforced

Row-level security filters *rows*, not *columns*. Reading the `alumni` table
directly meant anyone with the public anon key could request `personal_email`
and `phone_number` for every approved profile and get real answers.

So the browser no longer touches that table for public data. It reads
`public_alumni`, a view that contains only publishable columns, and `anon` has
had its `SELECT` on `alumni` revoked. Contact details are unreachable rather
than merely un-displayed. All public reads go through `lib/publicData.ts`.

## Environment variables

See `.env.local.example`. Two things worth knowing:

- Anything named `NEXT_PUBLIC_*` is compiled into the browser bundle. Only the
  Supabase URL and anon key belong there.
- `SUPABASE_SERVICE_ROLE_KEY` bypasses row-level security entirely. It is used
  only inside API routes (`lib/supabaseAdmin.ts`, which is marked `server-only`)
  and must never gain a `NEXT_PUBLIC_` prefix.

Email notifications and profile deletion degrade gracefully: until their keys
are set, the site works and simply skips those features.

## Project layout

```
app/
  page.tsx              home + showcase
  directory/            public directory and College Explorer
  register/             five-step registration wizard
  profile/              alumni self-service editor
  admin/                staff dashboard
  api/                  server routes (admin notify, delete)
lib/
  publicData.ts         every public read, via the safe view
  options.ts            one source of truth for all dropdown lists
  types.ts              shared types + category mapping
  supabaseAdmin.ts      service-role client, server only
scripts/                one-off data imports
```
