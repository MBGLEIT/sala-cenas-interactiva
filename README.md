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
npm run worker:plan-import
npm run worker:plan-import:once
npm run worker:plan-import:check
```

## Variables de entorno

El proyecto usa estas variables en `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
ADMIN_ACCESS_PASSWORD=
OPENAI_API_KEY=
OPENAI_IMPORT_MODEL=gpt-4.1
PLAN_IMPORT_WORKER_TOKEN=
PLAN_IMPORT_WORKER_POLL_MS=5000
```

Hay una plantilla en `.env.example`.

Si `OPENAI_API_KEY` esta configurada, el importador de planos usa GPT como capa principal
para imagenes y PDFs. Si no existe o falla, cae al importador determinista/fallback actual.

## Importador cloud para Vercel

La app web puede vivir en `Vercel`, pero el importador avanzado de planos necesita un
`worker externo` porque depende de:

- OCR pesado
- procesos largos
- Python / PaddleOCR / OpenCV
- filesystem temporal

Arquitectura prevista:

1. `Vercel` recibe la imagen y crea el job en Supabase.
2. `Supabase` guarda job, logs, samples y storage del archivo.
3. `Worker externo` consume `plan_import_jobs` y ejecuta el mismo importador avanzado.
4. La app en Vercel consulta `status`, muestra logs y abre la revision al terminar.

### Arranque del worker

Instala las dependencias de Python del importador:

```bash
pip install -r scripts/requirements-plan-import-worker.txt
```

Luego puedes lanzar el worker continuo:

```bash
npm run worker:plan-import
```

O procesar solo un job y salir:

```bash
npm run worker:plan-import:once
```

Tambien puedes ajustar el polling con:

```bash
PLAN_IMPORT_WORKER_POLL_MS=5000
```

### Despliegue del worker con Docker

Tambien puedes desplegar el worker como servicio separado usando:

```bash
docker build -f Dockerfile.plan-import-worker -t sala-cenas-plan-import-worker .
docker run --env-file .env.local sala-cenas-plan-import-worker
```

Ese contenedor esta pensado para plataformas tipo `Render`, `Railway`, `Fly.io` o cualquier
host que acepte un contenedor Docker separado del frontend de Vercel.

### Variables para produccion

- En `Vercel`:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
  - `SUPABASE_SECRET_KEY`
  - `ADMIN_ACCESS_PASSWORD`
  - `OPENAI_API_KEY`
  - `OPENAI_IMPORT_MODEL`
- En el `worker externo`:
  - las mismas variables de Supabase/OpenAI
  - Python con las librerias de `scripts/requirements-plan-import-worker.txt`

`PLAN_IMPORT_WORKER_TOKEN` solo hace falta si quieres usar el endpoint interno
`/api/internal/plan-import-worker/run-next` como disparador autenticado. El worker del repo
puede correr directamente contra Supabase sin pasar por ese endpoint.

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
