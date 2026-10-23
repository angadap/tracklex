#!/usr/bin/env bash
# Applies new files from supabase/migrations to the live database, in order, each in one transaction.
# Which files were already applied is remembered in tlx_ops.applied. The first time this runs, every file numbered
# below 0009 is recorded as already applied (they were applied by hand on 2026-10-22/23).
# Needs SUPABASE_DB_URL (the Session pooler connection string; GitHub runners cannot use the IPv6-only direct one).
set -euo pipefail
: "${SUPABASE_DB_URL:?SUPABASE_DB_URL is not set}"
q() { psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -qAt "$@"; }

q -c "create schema if not exists tlx_ops; revoke all on schema tlx_ops from public, anon, authenticated;
      create table if not exists tlx_ops.applied (name text primary key, applied_at timestamptz not null default now());"

if [ "$(q -c 'select count(*) from tlx_ops.applied')" = "0" ]; then
  for f in supabase/migrations/*.sql; do
    n=$(basename "$f")
    if [[ "$n" < "0009" ]]; then q -c "insert into tlx_ops.applied(name) values ('$n') on conflict do nothing"; echo "baseline: $n"; fi
  done
fi

for f in $(ls supabase/migrations/*.sql | sort); do
  n=$(basename "$f")
  if [ "$(q -c "select count(*) from tlx_ops.applied where name = '$n'")" = "0" ]; then
    echo "applying $n"
    psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 --single-transaction -q -f "$f" -c "insert into tlx_ops.applied(name) values ('$n')"
  else
    echo "already applied: $n"
  fi
done
echo "migrations up to date"
