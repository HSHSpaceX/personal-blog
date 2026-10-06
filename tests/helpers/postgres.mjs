import { readFile, readdir } from 'node:fs/promises';
export const modulePath = process.env.PGLITE_MODULE;
export const actors = {
  user: '00000001-0000-4000-8000-000000000001',
  other: '00000002-0000-4000-8000-000000000002',
  admin: '00000003-0000-4000-8000-000000000003',
  admin2: '00000004-0000-4000-8000-000000000004'
};
export async function createDatabase() {
  const { PGlite } = await import(modulePath);
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon nologin; create role authenticated nologin;
      create schema auth; create schema storage;
      grant usage on schema public, auth, storage to anon, authenticated;
      alter default privileges in schema public grant all on tables to anon, authenticated;
      alter default privileges in schema public grant all on functions to anon, authenticated;
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create table auth.users(id uuid primary key, raw_user_meta_data jsonb default '{}');
      create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
      alter table storage.objects enable row level security;
      grant select, insert, update, delete on storage.objects to anon, authenticated;
      create function storage.foldername(name text) returns text[] language sql immutable as
        $$ select string_to_array(name, '/') $$;
    `);
    for (const name of (await readdir(new URL('../../supabase/migrations/', import.meta.url))).sort()) {
      const sql = (await readFile(new URL('../../supabase/migrations/' + name, import.meta.url), 'utf8'))
        .replace('create extension if not exists pgcrypto;', '');
      await db.exec(sql);
    }
    return db;
  } catch (error) { await db.close(); throw error; }
}
export async function seedActors(db) {
  await db.query(`insert into auth.users(id,raw_user_meta_data) values
    ($1,'{"role":"admin"}'), ($2,'{}'), ($3,'{}'), ($4,'{}')`, Object.values(actors));
  await db.query("update public.user_roles set role='admin' where user_id in ($1,$2)", [actors.admin, actors.admin2]);
}
export async function asActor(db, role, id, sql, params = []) {
  if (!['anon', 'authenticated'].includes(role)) throw new Error('Invalid test role');
  await db.exec('begin');
  try {
    await db.exec(`set local role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [id || '']);
    const result = await db.query(sql, params);
    await db.exec('commit');
    return result;
  } catch (error) { await db.exec('rollback'); throw error; }
}
