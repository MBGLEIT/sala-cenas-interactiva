alter table public.asistentes
add column if not exists qr_reserva_token text;

create unique index if not exists asistentes_qr_reserva_token_key
on public.asistentes (qr_reserva_token)
where qr_reserva_token is not null;
