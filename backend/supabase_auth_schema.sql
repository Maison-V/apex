-- APEX — Access Control Schema
-- Run this ONCE in your Supabase project's SQL Editor (Database → SQL Editor).
-- It adds: a "profiles" table with role (member/ceo) and status (pending/approved/rejected),
-- an auto-create-on-signup trigger, CEO-only RLS, and an email notification trigger.
--
-- ⚠️  Before running: replace the two placeholders below (search for "REPLACE_ME"):
--   1) REPLACE_ME_WITH_YOUR_DEPLOYED_DOMAIN  → your live site URL, e.g. https://apex-yourteam.vercel.app
--   2) REPLACE_ME_WITH_A_LONG_RANDOM_SECRET  → any long random string (this must match the
--      SIGNUP_WEBHOOK_SECRET environment variable you set in Vercel — see setup notes)

-- ─────────────────────────────────────────────────────────────
-- 1. Table
-- ─────────────────────────────────────────────────────────────

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  role text not null default 'member' check (role in ('member', 'ceo')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references auth.users(id),
  last_seen_at timestamptz
);

create index if not exists idx_profiles_status on public.profiles (status);
create index if not exists idx_profiles_role on public.profiles (role);

alter table public.profiles enable row level security;

-- ─────────────────────────────────────────────────────────────
-- 2. Helper: is the current user the approved CEO?
--    security definer so it can read profiles even though regular
--    users get no direct SELECT-all policy below.
-- ─────────────────────────────────────────────────────────────

create or replace function public.is_ceo()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'ceo' and status = 'approved'
  );
$$;

-- ─────────────────────────────────────────────────────────────
-- 3. RLS policies
--    - Anyone can read their own row (so the app can show pending/rejected screens).
--    - The CEO can read every row.
--    - There is deliberately NO update policy for regular users — all writes
--      go through the security-definer RPCs below, which re-check is_ceo()
--      themselves. This is what guarantees only the CEO can approve/reject/
--      manage accounts, and that role can never be self-granted.
-- ─────────────────────────────────────────────────────────────

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles_select_ceo" on public.profiles;
create policy "profiles_select_ceo" on public.profiles
  for select using (public.is_ceo());

-- ─────────────────────────────────────────────────────────────
-- 4. Auto-create a profile row whenever someone signs up
--    (status always starts 'pending', role always starts 'member' —
--    these are hardcoded here, not taken from client input)
-- ─────────────────────────────────────────────────────────────

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role, status)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    'member',
    'pending'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ─────────────────────────────────────────────────────────────
-- 5. RPC: CEO approves / rejects / revokes / reinstates an account.
--    Callable from the app, but re-checks is_ceo() on every call —
--    a non-CEO calling this does nothing but raise an error.
-- ─────────────────────────────────────────────────────────────

create or replace function public.set_account_status(target_id uuid, new_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_ceo() then
    raise exception 'Only the CEO can manage accounts';
  end if;
  if new_status not in ('pending', 'approved', 'rejected') then
    raise exception 'Invalid status';
  end if;
  if exists (select 1 from public.profiles where id = target_id and role = 'ceo') then
    raise exception 'Cannot change the CEO account status here';
  end if;

  update public.profiles
  set
    status = new_status,
    approved_at = case when new_status = 'approved' then now() else approved_at end,
    approved_by = case when new_status = 'approved' then auth.uid() else approved_by end
  where id = target_id;
end;
$$;

grant execute on function public.set_account_status(uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────
-- 6. RPC: heartbeat, so the app can mark a signed-in member "online"
--    without giving anyone a general UPDATE policy on profiles.
-- ─────────────────────────────────────────────────────────────

create or replace function public.heartbeat()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles set last_seen_at = now() where id = auth.uid();
end;
$$;

grant execute on function public.heartbeat() to authenticated;

-- ─────────────────────────────────────────────────────────────
-- 7. Notify the CEO by email whenever someone new signs up.
--    Uses pg_net (Supabase's built-in async HTTP extension) to call
--    your site's /api/notify-signup endpoint, which sends the email.
-- ─────────────────────────────────────────────────────────────

create extension if not exists pg_net with schema extensions;

create or replace function public.notify_ceo_new_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url := 'REPLACE_ME_WITH_YOUR_DEPLOYED_DOMAIN/api/notify-signup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', 'REPLACE_ME_WITH_A_LONG_RANDOM_SECRET'
    ),
    body := jsonb_build_object(
      'id', new.id,
      'email', new.email,
      'full_name', new.full_name
    )
  );
  return new;
end;
$$;

drop trigger if exists on_profile_created_notify on public.profiles;
create trigger on_profile_created_notify
  after insert on public.profiles
  for each row execute procedure public.notify_ceo_new_signup();

-- ─────────────────────────────────────────────────────────────
-- 8. Bootstrap: make YOU the CEO.
--    Sign up for a normal account on the site first (through /signup,
--    using your own email), then run the statement below with your
--    real email substituted in. This is the ONLY way the 'ceo' role
--    is ever granted — there is no button or API route that does this,
--    on purpose.
-- ─────────────────────────────────────────────────────────────

-- update public.profiles
-- set role = 'ceo', status = 'approved', approved_at = now()
-- where email = 'you@yourcompany.com';
