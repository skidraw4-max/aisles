with
cols as (select string_agg(format('COL|%s|%s|%s|%s|%s|%s', c.relname, a.attname, format_type(a.atttypid,a.atttypmod), a.attnotnull, coalesce(pg_get_expr(d.adbin,d.adrelid),''), a.attnum), E'\n' order by c.relname,a.attnum) s
  from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where n.nspname='public' and c.relkind='r' and a.attnum>0 and not a.attisdropped),
tabs as (select string_agg(format('TAB|%s|rls=%s|force=%s', relname, relrowsecurity, relforcerowsecurity), E'\n' order by relname) s from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relkind='r'),
enums as (select string_agg(format('ENUM|%s|%s', t.typname, (select string_agg(enumlabel,',' order by enumsortorder) from pg_enum e where e.enumtypid=t.oid)), E'\n' order by t.typname) s from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typtype='e'),
idx as (select string_agg(format('IDX|%s|%s', tablename, indexdef), E'\n' order by tablename, indexname) s from pg_indexes where schemaname='public'),
cons as (select string_agg(format('CON|%s|%s|%s', c.conrelid::regclass, c.conname, pg_get_constraintdef(c.oid)), E'\n' order by c.conrelid::regclass::text, c.conname) s from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname='public'),
pol as (select coalesce(string_agg(format('POL|%s|%s|%s|%s', tablename, policyname, cmd, roles::text), E'\n' order by tablename,policyname),'') s from pg_policies where schemaname='public'),
seqs as (select coalesce(string_agg(format('SEQ|%s', sequencename), E'\n' order by sequencename),'') s from pg_sequences where schemaname='public')
select concat_ws(E'\n', tabs.s, enums.s, cols.s, idx.s, cons.s, pol.s, seqs.s) meta from tabs,enums,cols,idx,cons,pol,seqs;
