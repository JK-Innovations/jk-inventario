#!/bin/bash
# Apply the inventory migration to a throwaway local database and check it.
# Does not connect to the Supabase project.
set -euo pipefail
cd "$(dirname "$0")/.."
db=jkin_inv_test
sudo -u postgres psql -d postgres -v ON_ERROR_STOP=1 -c "drop database if exists ${db};"
sudo -u postgres psql -d postgres -v ON_ERROR_STOP=1 -c "create database ${db};"
sudo -u postgres psql -d "$db" -v ON_ERROR_STOP=1 -f test/harness.sql
sudo -u postgres psql -d "$db" -v ON_ERROR_STOP=1 -f supabase/001_inventory_schema.sql
sudo -u postgres psql -d "$db" -v ON_ERROR_STOP=1 -f supabase/001_inventory_schema.sql
sudo -u postgres psql -d "$db" -v ON_ERROR_STOP=1 -f supabase/002_seed_demo.sql
sudo -u postgres psql -d "$db" -v ON_ERROR_STOP=1 -f supabase/002_seed_demo.sql
if sudo -u postgres psql -d "$db" -v ON_ERROR_STOP=1 -f supabase/grant_admin.example.sql >/tmp/jkin-grant.out 2>/tmp/jkin-grant.err; then
  echo "grant_admin.example.sql should refuse the placeholder email" >&2
  exit 1
fi
grep -q "set the real email" /tmp/jkin-grant.err
sudo -u postgres psql -d "$db" -v ON_ERROR_STOP=1 -f test/assertions.sql
echo "inventory sql checks passed"
