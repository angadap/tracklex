# CLAUDE.md — Tracklex (score tracker and tournament organiser)

> Living project file. **Update this file every time the app changes** (new feature, new table, new decision). Add a line to the Changelog at the bottom.

## 1. What this is

**Tracklex** is a mobile-first web app to track scores and organise community tournaments. Its first event is the annual **Warje Olympics** (Pune, held Oct–Mar, organised via the local Nagarsevak). It replaces scattered Excel sheets with one system covering players, sports, results, fees and certificates, season after season (2022 ... 2026 and on).

Owner: Angad (also the organiser and sole coordinator for now).

## 2. Locked decisions

| Area | Decision |
|---|---|
| App name | **Tracklex** (chosen by Angad, 2026-10-19). "Warje Olympics" is the first *event* (season) inside the app, not the app name. Availability on Play Store, domain and trademark has NOT been checked yet. Internal storage key stays `warje.db.v1` so existing browser data is kept. |
| Sports | **Table Tennis is set up first** (fully working). Badminton is listed as "Setup coming soon". More sports are added gradually (Chess, Athletics, Kabaddi, Kho-Kho, Volleyball, Basketball). Cricket is excluded (separate app). |
| Roles | Three roles plus permission levels, see section 6a. **Admin** is the super role (everything, plus player profiles, PINs, season settings and organiser access). **Organiser** access = one sport + a set of permissions (categories and fees, entries and payments, draws, scores). Presets: Full organiser, Registration desk, Scorer, or a custom mix. It can be given to a new organiser account (username + password) or to an existing **player** account, which keeps its mobile + PIN login and players and also gets the tournament console. Organisers never edit player profiles, PINs or settings. **Player** account (parent or adult) manages self + child profiles and registers. Public visitors can read categories and matches. |
| Login | **Two separate logins on one front-door screen.** Players: mobile number + self-set 4–6 digit PIN, with a "New registration" form (name, mobile, PIN, confirm PIN). Admin and organisers: **username + password** on the "Admin / Organiser" tab (min 8 characters, each changes their own under Change password). No SMS OTP (it costs money). Only the admin can reset a player's forgotten PIN. PINs and passwords are stored hashed (SHA-256). |
| App entry | The app opens on the sign-in screen. "Continue without signing in" gives read-only browsing (categories, matches). Registering, profile and organiser pages need an account. |
| Kids | No separate account. A parent account holds self and child players. |
| Categories | Age and gender categories are **fully configurable** by the organiser: name, gender (men/women/mixed), format (singles/doubles), min and max age (inclusive), fee. **Age is always counted on today's date** (Angad, 2026-10-23), not a fixed cutoff. Never hard-code categories. |
| Fees | Set per category by the organiser. **Payment is manual**: players pay the organiser directly, the organiser marks entries paid. No payment gateway yet. |
| Society standings | **Not required on the home page** (Angad, 2026-10-18). Society is still stored on each player. Medal points and a leaderboard are parked. |
| Certificates | Basic regular format later. Not built yet. |
| Monetization | Cut of participation fees, sponsor banners, possibly society subscriptions. Not built yet. |

## 3. Tech stack

- **Frontend:** React 18 + Vite 6 + Tailwind CSS v4 (`@tailwindcss/vite`), React Router v6, lucide-react, @fontsource (Barlow Condensed, Manrope). No form library; plain controlled forms.
- **Two data modes, picked at start-up by env vars** (`src/lib/db.js`):
  - **live**: `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` set -> Supabase, shared by every phone (`src/lib/remote.js`).
  - **demo**: not set -> browser-only localStorage (`src/lib/local.js`, key `warje.db.v1`, demo admin `admin` / `admin123`). Used for offline tests.
  - Both expose identical async functions; rules and selectors shared by both are in `src/lib/core.js`. Screens only import `db.js`.
- **Database:** Supabase project "Tracklex" (ref `xboufkrnmjyidpquipoj`, `https://xboufkrnmjyidpquipoj.supabase.co`, ap-south-1 Mumbai, org MathsApp). The other project, "Mathelex" (his maths app), must NEVER be touched. See section 3a.
- **Repo:** GitHub `angadap/tracklex` (private, branch main). **Deploy:** Cloudflare Workers static assets (`wrangler.jsonc`: serves `dist`, single-page-app fallback; build `npm run build`, deploy `npx wrangler deploy`). The two Supabase env vars are committed in `.env.production` (publishable key only), so no dashboard variables are needed.

## 3a. Backend (Supabase)

Migrations in `supabase/migrations/`, applied in order (`supabase/schema.sql` is just a pointer):

| File | What | Status |
|---|---|---|
| `0001_tables.sql` | sports, settings, profiles, players, categories, registrations, matches, app_secrets, login_attempts | applied |
| `0002_access.sql` | helper functions (`my_role`, `is_admin`, `can_manage`, ...), `list_entries()`, RLS: clients can only READ; write grants revoked | applied |
| `0004_auth_attempts.sql` | atomic `auth_attempt()` counter, service role only | applied |
| `0005_permissions.sql` | `profiles.perms`, new shape check (players may carry sport + perms), `can_manage`, `has_perm`, `require_perm`, entries-read policy | applied (2026-10-22, via SQL editor) |
| `0006_tournaments.sql` | `tournaments`, `stages`; categories belong to a tournament; matches belong to a stage (`group_no`, `scheduled_at`, nullable player 1 for byes); public read RLS; `stage_standings()` | applied (2026-10-22) |
| `0008_player_extras_and_age.sql` | `players.tshirt`, `players.photo`, `set_player_extras()`, `register_entry` counts age today (Asia/Kolkata) | applied (2026-10-23, via the tool) |
| `0007_actions.sql` | all write functions (SECURITY DEFINER) that check role, permission and rules: players, entries, `save_tournament`, `save_category`, `save_stage`, `generate_stage`, `save_match`, `set_schedule`, `save_score`, `clear_stage` and more. Friendly errors are shown verbatim in the app | applied (2026-10-22, via SQL editor; the Supabase tool refuses `drop`/`delete`, so future migrations containing them must be pasted by the user) |

`supabase/APPLY_IN_SQL_EDITOR.sql` = 0005 + 0006 + 0007 in one paste (safe to re-run).

- **Writes** go only through those functions; **reads** are plain selects limited by RLS. Public: sports, settings, categories, matches, and `list_entries()` (bracket names only, no dob, mobile or payment). Private: profiles (own or admin), players (own, admin, or organiser of a sport the player is in), registrations (owner or the sport's manager).
- **Sign-in** is the edge function `tlx-auth` (`supabase/functions/tlx-auth/index.ts`, verify_jwt off). Actions: signup, signin, staff-signin, reset-pin, save-organiser, grant-organiser, delete-organiser (also removes only the organiser access of a promoted player), change-password, reset-all-data, bootstrap-admin. The real Auth password is HMAC-SHA256(pepper, ...); the pepper is in table `app_secrets`, so the PIN is never the Auth password and nobody can guess into Supabase Auth directly. Fake emails: `<mobile>@players.tracklex.invalid`, `<username>@staff.tracklex.invalid`.
- **Throttling:** 5 wrong attempts per account then a 15-minute lock; per IP 60 sign-ins per 15 min and 10 sign-ups per hour. Counted before the PIN is checked (atomic), so parallel guesses cannot sneak through.
- **Known limits (prototype grade):** anyone can lock a known account for 15 minutes by guessing; no email recovery (admin resets player PINs; a lost admin password needs the database); no payment gateway.
- **Env vars** (Cloudflare Pages, Settings, Variables): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (the publishable key). Never use the secret/service_role key in the app. See `.env.example`.
- **First admin:** created once by `bootstrap-admin` (username `angad`). Temporary password was given to Angad in chat; change it under Change password at first sign-in.
- **Testing notes:** this sandbox cannot reach supabase.co, so server tests ran through `execute_sql` using `pg_net` (`net.http_post`). Responses expire after ~6 h, tokens last 1 h, requests only fire after the transaction commits. Test data (player Rahul 9876543210, organisers `tt_org`, `tt_org2`, `tt_scorer`) must be wiped with Settings, "Wipe test data" before real use.

## 3b. Automatic deployment

- **Website:** Cloudflare Workers Builds is connected to `angadap/tracklex`, production branch `main`, builds on. Every push to `main` builds (`npm run build`) and deploys (`npx wrangler deploy`).
- **Tests:** `.github/workflows/ci.yml` runs the data and database tests and a build on every push and pull request.
- **Backend:** no Supabase account token is stored anywhere (it would reach every project in the org, including Mathelex; Angad's decision 2026-10-23). Database changes and the `tlx-auth` function are applied by Claude directly through the Supabase tool after local tests; migrations containing `drop`/`delete` are pasted by Angad in the SQL editor. Optional: `.github/workflows/supabase.yml` is a manual (Run workflow) job that applies new migration files with `scripts/apply_migrations.sh` using a `SUPABASE_DB_URL` secret held in a protected GitHub environment named `production` with a required reviewer. It does nothing without that secret.
- Write migrations to be safe to run once, and test them in `tests/sql` first.

## 4. Design system ("Match day")

Dark, immersive pro-sports-app look, chosen by Angad from three mockups. History: dark navy/gold felt childish, light/white felt like a book. Do not go back to either.

- **Palette (tokens in `src/index.css`):** void `#0A0B12` page, surface `#171927` cards and nav, surface-2 `#1F2234` inputs and chips, hair `#232638` borders, soft `#9AA0B8` and muted `#7E86A6` secondary text, live `#4ADE80`. White is primary text and primary buttons (dark text on white pill).
- **Sport colours (`src/data/sports.js`):** Table Tennis blue `#2B2BFF -> #00A6FF`, Badminton pink-orange `#FF2D6F -> #FF9440`. Each new sport gets its own gradient.
- **Type:** Barlow Condensed 800 italic uppercase for big headings and numbers (`font-display`), Manrope for everything else.
- **Components (`src/components/ui.jsx`):** Page, TopBar, Btn (primary / soft / ghost / danger), Field, Chip (neutral / good / warn), Card, SectionTitle, Empty, ErrorText, Segmented, Sheet (bottom sheet dialog). Reuse these; do not restyle per screen.
- **Navigation:** floating pill bottom bar (Home, Register, Profile, plus Admin for the organiser). Only the active tab shows its label.
- **Copy rules:** sentence case, action-named buttons, errors say what to fix, empty states say what happens next. Never show made-up numbers in the app.
- **Quality floor:** works at 390px, visible focus ring, motion respects `prefers-reduced-motion`.

## 5. Folder structure

```
tracklex/
├── CLAUDE.md
├── .env.example                 <- the two env vars for live mode
├── supabase/migrations/         <- 0001..0008 SQL (see 3a)
├── supabase/functions/tlx-auth/ <- sign-in edge function
├── tests/                       <- data-layer, SQL (PGlite) and browser tests, see tests/README.md
├── index.html, vite.config.js, package.json
└── src/
    ├── main.jsx                 <- bootstraps router, seeds demo organiser
    ├── App.jsx                  <- routes + AdminOnly guard
    ├── index.css                <- theme tokens, motion
    ├── lib/db.js                <- picks backend; re-exports core.js
    ├── lib/core.js              <- rules and selectors shared by both backends
    ├── lib/remote.js            <- live Supabase backend
    ├── lib/local.js             <- offline demo backend
    ├── data/sports.js           <- sport list, gradients, ready flag
    ├── components/              <- BottomNav, SportIcons, MatchRow, CategoryResults, PlayerPhoto, ui
    └── pages/
        ├── Home.jsx, SportPage.jsx, Register.jsx, Auth.jsx, Profile.jsx, Placeholder.jsx
        └── admin/ AdminHome, Tournaments, TournamentPage, CategoryPage, Players, Settings (admin), Organisers (admin), Password
```

## 6. Routes and screens

| Path | Who | What |
|---|---|---|
| `/` | all | Season, greeting, sport cards |
| `/sport/table-tennis` | all | List of the sport's tournaments (dates, categories, entries, open/closed). Admin/organiser also see "Set up tournaments" |
| `/sport/table-tennis/t/:tid` | all | One tournament: categories with fees and entry counts, matches by round, champion. Register button; organiser also sees "Set up" |
| `/sport/badminton` | all | "Setup coming soon" |
| `/sport/table-tennis/register?t=<tournament>` | player | Pick tournament (when more than one), player (self/child), eligible events, partner name for doubles, total fee |
| `/login`, `/signup` | all | Front door: Player / Organiser tabs; player has Sign in / New registration. `/signup` opens the registration tab. Signed-in users are sent away from these pages (organiser to `/admin`, player to `/`) |
| `/profile` | player | Account, players (add/edit/remove; optional T-shirt size and photo), each player's entries with Paid/Due, withdraw, fees due, sign out |
| `/profile` | organiser | Name and username, open console, change password, sign out |
| `/admin` | admin, organiser (incl. promoted players) | Dashboard; tiles shown only for permissions held;: totals and links. Admin also gets Organisers and Season settings. Everyone gets Change password |
| `/admin/tournaments` | admin, organiser (setup perm) | Tournaments of the organiser's sport(s): name, season, start/end dates, entries open/closed |
| `/admin/tournaments/:tid` | same | The tournament's categories (add/edit/delete, "Add starter set"), edit or delete the tournament |
| `/admin/categories/:cid` | admin, organiser | One category: its stages (add from template or custom, edit, reorder, delete), make matches / next round, add match slots (players, round name, number, date and time), enter or clear results, standings, clear stage |
| `/admin/players` | admin, organiser | Entries (search, filter, mark paid/unpaid, withdraw). Admin only: Accounts tab with reset PIN, edit and remove player profiles. Organiser sees a read-only note |
| `/admin/settings` | admin | Data tools: wipe test data (season and cutoff now live on each tournament) (organisers are redirected to `/admin`) |
| `/admin/organisers` | admin | Two ways to add: "From a player" (picks a player account) or "New account" (username + password). Choose a sport and a level (presets or ticks). Edit, or remove (a promoted player stays a player). Username fixed after creation; blank password on edit keeps the old one |
| `/admin/password` | admin, organiser | Change own password |

## 6a. Who can do what

Organiser permissions (`perms`), per sport. Admin has all of them in every sport.

| Permission | Lets them |
|---|---|
| `categories` | create and edit tournaments, categories, fees and stages; add the starter set |
| `entries` | see entries and payment status (and the players in them), mark paid, withdraw entries |
| `draws` | make matches and rounds, add match slots, set dates and times, clear a stage |
| `scores` | enter match results |

| Action | Admin | Organiser with the permission (own sport) | Player |
|---|---|---|---|
| Categories / entries and payments / draws / scores | yes | only what their permissions allow | no |
| Same actions on another sport | yes | **no** | no |
| Edit or remove player profiles, reset PINs | yes | **no** | own profiles only |
| Season settings, wipe test data | yes | no | no |
| Create, edit, remove organisers; make a player an organiser | yes | no | no |
| Change own password | yes | organiser accounts only | n/a (PIN) |
| Register players for events | no | only if a player account | yes |

A scorer sees the dashboard, matches and brackets only; entries and fees are hidden because they would show wrong numbers. Enforced in the database functions (`require_perm`) and in the demo backend, not just hidden in the UI.

## 7. Rules implemented (in `db.js`)

- Eligibility: player's age **today** (India time on the server) within min–max, and category gender matches (mixed accepts all).
- One entry per player per category; doubles needs a partner name; entries close once a category's draw exists.
- Withdraw blocked once the player is in a match. A category with entries cannot be deleted. A player with entries cannot be removed.
- Structure: Sport -> Tournament (per sport per event: name, season, age cutoff, dates, entries open/closed) -> Categories (age/gender groups; players are divided by category) -> Stages (ordered per category) -> Match slots (players, score, date and time; no table or referee).
- Stage kinds: **knockout** (random round 1 with byes, next round from winners; Final / Semi-finals / Quarter-finals / Round N), **round robin** (groups, play once or twice, top N advance), **custom** (slots added by hand). Stages are made from templates and are freely editable. A later stage takes the top `advance` per group of the previous stage (wins, then game difference, games won, then entry id).
- A match cannot end level. Results lock once a later stage has matches (knockout: once the next round exists); clearing a stage also clears later ones. The champion comes only from the last stage (knockout final, or the table leader of a single group).
- Entries close when the tournament's entries are closed or a stage has matches.
- Players have an optional T-shirt size (Kids S/M/L, XS to 3XL) and an optional photo. The app shrinks the photo to about 320px JPEG and stores it on the player row (`players.photo`, visible only to the owner, admin and the sport's entries organiser). Saved by `set_player_extras` right after `save_player`.
- Permissions follow section 6a (UI hides what is not allowed; the server refuses it anyway). Organiser username: 3 to 20 characters of a-z, 0-9, dot, dash, underscore, unique; password at least 8 characters.
- Player accounts and staff accounts are separate: player credentials do not work on the staff tab and the reverse. Staff cannot register players; the Register tab is replaced by Admin / Organiser in their nav.
- After signing in, players return to the page they were trying to open (new registrations go to Profile to add players); organisers go to `/admin`.

## 8. Demo access (demo mode only; live mode has no demo accounts)

Seeded admin: username `admin`, password `admin123` (shown on the staff tab). Change it under Change password straight away. Create organisers from Admin, Organisers. Replace with real organiser accounts when moving to Supabase. Because data is in the browser only, the seeded organiser exists separately in every browser. Real auth also needs server-side rate limiting on failed attempts (not possible in this prototype).

## 9. Run locally

```
npm install
npm run dev      # http://localhost:5173
npm run build    # outputs dist/
```

## 10. Testing done (2026-10-18)

Browser walkthroughs at 390px, no console errors:
- Table Tennis: organiser sets categories and fees, 4 players sign up (one with a child), eligibility by age and gender, doubles partner required, mark paid, random draw, semis, final, champion, tie rejected.
- Login: fresh visit redirects to sign-in; guest browsing works and `/admin` sends guests to the organiser tab; registration checks (PIN mismatch, bad mobile, short PIN, duplicate mobile); wrong PIN and wrong password messages; player and organiser credentials do not cross over; players blocked from `/admin`; organiser password change (short, wrong current, success, old password rejected); admin PIN reset then sign-in with the new PIN; session survives reload.

Roles (2026-10-19): 46 data-layer permission checks (`perm_test`: organiser can run own tournament, cannot edit players, PINs, settings, organisers or another sport's tournament; admin can) and 24 browser checks at 390px (admin creates organiser, organiser nav and dashboard, blocked routes, own password change, admin edits player profile, player blocked from `/admin`), no console errors.

Live sign-in function (2026-10-21, via pg_net): signup and duplicate mobile, player and staff sign-in, bootstrap refused after first admin, anonymous and player callers refused for admin actions, organiser refused for reset-pin, save-organiser, delete-organiser and reset-all-data, organiser creation rules, PIN reset, wrong current password refused, and lockout: 8 simultaneous wrong PINs gave exactly 5 checks and 3 locked. NOT yet tested live: the 0006 write functions (not applied), delete-organiser and reset-all-data as admin, the app against the live database.

## 11. Next steps

1. Set the two env vars on Cloudflare Pages, deploy, then test the live app in a browser (`remote.js` has not run against the live database yet; the sandbox cannot reach supabase.co). The old `settings` table is now unused.
2. Wipe test data (organisers tt_org, tt_org2, tt_scorer) from Admin, Data tools; change the admin password
3. Badminton setup (reuse the Table Tennis screens with a sport parameter)
4. Basic certificates (participation and winner)
5. Records / hall of fame across seasons; medal points and society standings if wanted again

## Changelog

- **2026-10-17 — v0.1.0:** Project scaffolded. Home with sport picker, placeholders.
- **2026-10-17 — v0.2.0:** Redesigned to a light look (rejected as "like a book").
- **2026-10-17 — v0.3.0:** Redesigned to the dark "Match day" look. Fonts bundled with @fontsource.
- **2026-10-18 — v0.4.0:** Removed society standings from Home. Table Tennis fully set up: mobile + PIN accounts, profile with self and child players, registration with age/gender eligibility, doubles partners, manual fee tracking. Organiser console: dashboard totals, configurable categories and fees, players and payments, PIN reset, random knockout draws with byes, score entry, champion, season settings. Added `src/lib/db.js` (localStorage data layer), `supabase/schema.sql` (not applied), shared UI kit. Badminton shows "Setup coming soon".
- **2026-10-18 — v0.5.0:** Login for the whole app. New front-door screen with Player / Organiser tabs. Players: mobile + PIN sign in and a new registration form (name, mobile, PIN, confirm PIN). Organiser: separate username + password login with password change in Settings (replaces the old mobile-based demo organiser, now `admin` / `admin123`). App opens on sign-in; optional read-only guest browsing. Organiser nav and profile are separate from the player's. Data layer: `adminSignIn`, `changeAdminPassword`, `continueAsGuest`; `resetAllData` no longer signs the organiser out.
- **2026-10-19 — v0.6.0:** Admin and organiser are now separate roles. Admin is the super role. Organisers are created by the admin (new Organisers screen), assigned to one sport, and can fully run that sport's tournament (categories, fees, payments, draws, scores) but cannot edit player profiles, reset PINs, change season settings or manage organisers. Admin can now edit and remove player profiles. Staff login tab renamed "Admin / Organiser"; new Change password screen for both (moved out of Settings). Data layer: `isStaff`, `canManage`, `staffSignIn`, `changeStaffPassword`, `saveOrganiser`, `deleteOrganiser`, `adminSavePlayer`, `adminRemovePlayer`. Schema updated for the organiser role.
- **2026-10-19 — v0.6.1:** App renamed **Tracklex**. Warje Olympics stays as the first event name, shown next to the brand on Home and the sign-in screen. Page title, package name and schema header updated.
- **2026-10-19:** Supabase project Tracklex created (empty). No app change.
- **2026-10-21 — v0.7.0:** Live backend. Supabase tables, row-level security (read-only for clients), write functions with role and rule checks (0003, pending apply), throttled sign-in edge function `tlx-auth`, first admin created. App now has two modes (live via env vars, demo otherwise); data layer split into `core.js`, `local.js`, `remote.js`, all actions async. Added `.env.example`. Demo-mode tests: 46 permission checks and 24 browser checks green. Live end-to-end not yet verified (waiting for 0003).
- **2026-10-21 — v0.8.0:** Organiser permission levels (categories, entries, draws, scores; presets Full organiser / Registration desk / Scorer) and "make a player an organiser" (player keeps mobile + PIN login and players, gains the console for one sport). New `0005_permissions.sql`, `0006_actions.sql` (was 0003) with `require_perm`; edge function v3 (`grant-organiser`, perms on organiser accounts). Organisers screen rebuilt; dashboard, routes and Matches page respect permissions. Removed 8 unused old files. Demo-mode tests: 46 + 36 permission checks green.
- **2026-10-22 — v0.9.0:** Tournament structure. Sport -> Tournament -> Categories -> Stages -> Match slots. Admin and organisers with the setup permission create tournaments (season, age cutoff and entries open/closed moved here from season settings), age/gender categories, and stages from templates (knockout, round robin with groups and 1 or 2 legs and N advancing, custom) that can be edited, reordered and chained; match slots hold players, score, round name and date/time. New migrations `0006_tournaments.sql` and `0007_actions.sql` (old 0006_actions replaced; `save_settings`, `generate_round`, `clear_draw` removed). New screens Tournaments, TournamentPage, CategoryPage; removed Categories and Matches screens; public sport page has a tournament picker, stages and tables. Edge function v4 (wipe also clears tournaments). Tests: 166 data-layer rule checks, 95 PGlite database-rule checks, 16 browser checks (390px) green in demo mode; migrations 0005 (part), 0006 and 0007 NOT yet applied live.
- **2026-10-22 — live database updated:** 0005 (rest), 0006 and 0007 applied via the SQL editor. Live rule test (impersonating admin, organiser, scorer, player and anonymous in a rolled-back transaction) all green: anon and scorer refused, other-sport refused, starter categories and stages, entries, closed entries, duplicate entry, knockout through to champion, results lock, round robin (6 matches for 4), schedule, format change refused, clear stage, delete tournament with entries refused, anon cannot read registrations. Supabase advisors: only expected warnings (write functions are SECURITY DEFINER by design and check the caller inside; leaked-password protection is irrelevant because Auth passwords are derived by the sign-in function). Code pushed to GitHub.
- **2026-10-23 — deploy:** Cloudflare build succeeded but had no env vars (would have run in demo mode) and no asset config. Added `wrangler.jsonc` and `.env.production`.
- **2026-10-23 — v0.10.0:** (1) Ages are always counted on today's date (no cutoff date; the field is gone from the tournament form, the column stays unused). (2) Player view of a sport: list of tournaments first, tap one to see its categories and matches (`/sport/:slug/t/:tid`); Register has a tournament picker. (3) Optional T-shirt size and photo (phone camera or gallery) on a player profile; shown on the profile and in the organiser's entries list. New migration `0008_player_extras_and_age.sql`, applied live. (4) App title is "Tracklex - Tournaments Tracker" (sign-in, home, browser tab). Tests: 10 new data checks, 11 new database checks, 13 new browser checks; all suites green. Note: browser tests must run against a demo-mode build (`npx vite build --mode demo --outDir /tmp/demo-dist`) because `.env.production` makes a normal build use the live database.
