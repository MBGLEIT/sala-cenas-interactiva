create table if not exists public.admin_management_changes (
  id bigserial primary key,
  source_table text not null,
  changed_at timestamptz not null default now()
);

alter table public.admin_management_changes enable row level security;

drop policy if exists "admin_management_changes_select_public" on public.admin_management_changes;
create policy "admin_management_changes_select_public"
  on public.admin_management_changes
  for select
  to anon
  using (true);

create or replace function public.notify_admin_management_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.admin_management_changes(source_table)
  values (tg_table_name);

  delete from public.admin_management_changes
  where id in (
    select id
    from public.admin_management_changes
    order by id desc
    offset 200
  );

  return coalesce(new, old);
end;
$$;

drop trigger if exists notify_admin_users_management_change on public.admin_users;
create trigger notify_admin_users_management_change
  after insert or update or delete on public.admin_users
  for each row
  execute function public.notify_admin_management_change();

drop trigger if exists notify_admin_audit_logs_management_change on public.admin_audit_logs;
create trigger notify_admin_audit_logs_management_change
  after insert or update or delete on public.admin_audit_logs
  for each row
  execute function public.notify_admin_management_change();

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'admin_management_changes'
  ) then
    alter publication supabase_realtime add table public.admin_management_changes;
  end if;
end
$$;
