# Tests

- `node tests/data/perm_test.mjs`, `perm2_test.mjs`, `perm3_test.mjs` — rules and permissions through the demo backend (166 checks).
- `node tests/sql/sql_test.mjs` — runs migrations 0001, 0002, 0004–0007 in PGlite and checks the database rules (95 checks).
- `tests/browser/e2e_tournament.py` — Playwright walkthrough at 390px against `npm run build && npx vite preview --port 4173` (needs `seed.mjs` output as `seed.json`).
