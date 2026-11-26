create schema auth;
create role authenticated;
create role anon;
create table auth.users(id uuid primary key,email text not null,email_confirmed_at timestamptz,is_anonymous boolean default false);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
create table demo_samples(account uuid primary key,circle uuid);
