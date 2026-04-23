# Sala de Cenas Interactiva

Proyecto real de aprendizaje construido con:

- Next.js 14
- React 18
- Supabase
- Tailwind CSS
- Zod
- react-konva

## Estado actual

La Fase 6 esta terminada.

Ahora mismo el proyecto ya:

- Identifica asistentes por su codigo
- Carga la sala del evento
- Dibuja mesas y sillas en un plano interactivo
- Muestra estados visuales de las sillas:
  libre, ocupada, seleccionada y asignada al asistente actual
- Permite confirmar reservas
- Escucha cambios en tiempo real sobre la tabla `reservas`

La siguiente fase pendiente es la Fase 7, centrada en mejorar UX y preparar despliegue.

## Scripts

```bash
npm run dev
npm run lint
npm run build
npm run start
```

## Variables de entorno

El proyecto usa estas variables en `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

Hay una plantilla en `.env.example`.

## Base de datos y Supabase

Los archivos importantes de Supabase estan en:

- `supabase/migrations/20260423090953_init_schema.sql`
- `supabase/migrations/20260423093657_enable_rls_policies.sql`
- `supabase/migrations/20260423100015_grant_api_access.sql`
- `supabase/migrations/20260423105555_enable_realtime_for_reservas.sql`
- `supabase/seed.sql`

## Flujo de prueba rapido

1. Ejecuta `seed.sql` en Supabase para resetear los datos de prueba.
2. Arranca la app con `npm run dev`.
3. Prueba identificadores como:
   `ANA-104`, `CAR-208`, `LUC-315`.

## Nota

Si ves comportamientos raros en desarrollo, lo normal es:

1. parar `next dev`
2. volver a lanzarlo
3. refrescar el navegador con `Ctrl + F5`

Esto evita quedarte con procesos o respuestas viejas en local.

## Despliegue

La guia de salida a produccion de la Fase 7 esta en:

- `docs/fase-7-produccion.md`
