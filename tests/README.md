# Tests

- `node tests/data/perm_test.mjs`, `perm2_test.mjs`, `perm3_test.mjs` — rules and permissions through the demo backend (166 checks).
- `node tests/sql/sql_test.mjs` — runs migrations 0001, 0002, 0004–0007 in PGlite and checks the database rules (95 checks).
- `tests/browser/e2e_tournament.py` — Playwright walkthrough at 390px against `npm run build && npx vite preview --port 4173` (needs `seed.mjs` output as `seed.json`).
- `node tests/data/perm4_test.mjs` — age counted today, T-shirt and photo (10 checks).
- `tests/browser/e2e_player_changes.py` — player view: tournament list, categories inside, T-shirt and photo, titles (13 checks).
- Browser tests need a demo-mode build: `npx vite build --mode demo --outDir /tmp/demo-dist && npx vite preview --port 4180 --outDir /tmp/demo-dist` (a normal build uses the live database because of `.env.production`). Create `/tmp/seed.json` with `node tests/browser/seed.mjs > /tmp/seed.json`.
