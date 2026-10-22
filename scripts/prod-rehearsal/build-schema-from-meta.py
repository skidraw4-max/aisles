#!/usr/bin/env python3
"""Rebuild a schema-only copy of production public schema from read-only catalog metadata.

Input: metadata file produced by meta.sql (TAB/ENUM/COL/IDX/CON/POL lines). No row data.
Output: DDL on stdout. Supabase-only objects (auth.users, anon/authenticated roles) must exist as stubs.
"""
import sys, collections
lines=[l.rstrip('\n') for l in open(sys.argv[1]) if l.strip()]
tabs=collections.OrderedDict(); enums=[]; cols=collections.defaultdict(list); idx=[]; cons=[]; pols=[]
for l in lines:
    k,rest=l.split('|',1)
    if k=='TAB':
        n,r,f=rest.split('|'); tabs[n]=(r.endswith('t'),f.endswith('t'))
    elif k=='ENUM':
        n,v=rest.split('|',1); enums.append((n,v.split(',')))
    elif k=='COL':
        t,c,ty,nn,df,num=rest.split('|'); cols[t].append((int(num),c,ty,nn=='t',df))
    elif k=='IDX':
        t,d=rest.split('|',1); idx.append((t,d))
    elif k=='CON':
        t,n,d=rest.split('|',2); cons.append((t.strip('"'),n,d))
    elif k=='POL':
        t,n,cmd,roles=rest.split('|'); pols.append((t,n,cmd,roles.strip('{}')))
q=lambda s:'"'+s+'"'
out=[]
for n,vals in enums:
    out.append('CREATE TYPE %s AS ENUM (%s);'%(q(n),', '.join("'"+v+"'" for v in vals)))
for t in tabs:
    body=[]
    for _,c,ty,nn,df in sorted(cols[t]):
        s='  %s %s'%(q(c),ty)
        if df: s+=' DEFAULT '+df
        if nn: s+=' NOT NULL'
        body.append(s)
    out.append('CREATE TABLE %s (\n%s\n);'%(q(t),',\n'.join(body)))
conidx=set(n for _,n,_ in cons)
order=lambda d:0 if d.startswith('PRIMARY') else 1 if d.startswith('UNIQUE') else 2 if d.startswith('CHECK') else 3
for t,n,d in sorted(cons,key=lambda x:order(x[2])):
    if order(d)<3: out.append('ALTER TABLE %s ADD CONSTRAINT %s %s;'%(q(t),q(n),d))
for t,d in idx:
    name=d.split(' INDEX ',1)[1].split(' ON ',1)[0].strip('"')
    if name in conidx: continue
    out.append(d+';')
for t,n,d in cons:
    if order(d)==3: out.append('ALTER TABLE %s ADD CONSTRAINT %s %s;'%(q(t),q(n),d))
for t,(r,f) in tabs.items():
    if r: out.append('ALTER TABLE %s ENABLE ROW LEVEL SECURITY;'%q(t))
    if f: out.append('ALTER TABLE %s FORCE ROW LEVEL SECURITY;'%q(t))
for t,n,cmd,roles in pols:
    out.append('CREATE POLICY %s ON %s FOR %s TO %s USING (true);'%(q(n),q(t),cmd,roles))
print('\n'.join(out))
