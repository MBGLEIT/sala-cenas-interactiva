create table if not exists public.admin_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null,
  password_hash text not null,
  status text not null default 'pending' check (
    status in ('pending', 'approved', 'active', 'rejected', 'disabled')
  ),
  totp_secret text,
  totp_enabled boolean not null default false,
  approved_at timestamptz,
  approved_by uuid references public.admin_users(id) on delete set null,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists admin_users_status_idx on public.admin_users(status);
create index if not exists admin_users_created_at_idx on public.admin_users(created_at desc);

alter table public.admin_users enable row level security;

drop policy if exists "admin_users_no_public_access" on public.admin_users;
create policy "admin_users_no_public_access"
  on public.admin_users
  for all
  using (false)
  with check (false);

create or replace function public.set_admin_users_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_admin_users_updated_at on public.admin_users;
create trigger set_admin_users_updated_at
  before update on public.admin_users
  for each row
  execute function public.set_admin_users_updated_at();
