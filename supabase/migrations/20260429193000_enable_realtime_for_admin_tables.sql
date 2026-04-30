do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'eventos'
  ) then
    alter publication supabase_realtime add table public.eventos;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'asistentes'
  ) then
    alter publication supabase_realtime add table public.asistentes;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'mesas'
  ) then
    alter publication supabase_realtime add table public.mesas;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'sillas'
  ) then
    alter publication supabase_realtime add table public.sillas;
  end if;
end
$$;
