#!/usr/bin/env bash
# Recreate local schema-only production copy (loopback Postgres only).
set -euo pipefail
DB=${1:-jury_prodcopy}; META=${2:?meta}; MIG=${3:?prod_migrations.psv}
here=$(cd "$(dirname "$0")" && pwd)
sudo -u postgres psql -qc "drop database if exists $DB" -c "create database $DB owner jury"
sudo -u postgres psql -q $DB <<'SQL'
do $$begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; end$$;
create schema auth authorization jury; create table auth.users(id uuid primary key); alter table auth.users owner to jury;
SQL
export PGPASSWORD=jury
python3 "$here/build-schema-from-meta.py" "$META" | psql -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -U jury $DB
# _prisma_migrations rows mirrored from production (logs omitted)
python3 - "$MIG" <<'PY' | psql -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -U jury $DB
import sys
n=lambda v:'NULL' if v=='' else "'"+v+"'"
for l in open(sys.argv[1]):
    f=l.rstrip('\n').split('|')
    print("insert into _prisma_migrations(id,checksum,finished_at,migration_name,rolled_back_at,started_at,applied_steps_count) values(%s,%s,%s,%s,%s,%s,%s);"%(n(f[0]),n(f[1]),n(f[2]),n(f[3]),n(f[4]),n(f[5]),f[6]))
PY
echo "copy $DB ready"
