# Despliegue del Importador Cloud

Esta guia deja el proyecto funcionando con:

- `Vercel` para la app web y la orquestacion
- `Supabase` para jobs, logs, samples y storage
- `Worker externo` para OCR/importacion avanzada

## 1. Aplicar la migracion en Supabase

La migracion nueva es:

- `supabase/migrations/20260525093000_create_plan_import_cloud_tables.sql`

Aplicala en tu proyecto remoto con el flujo habitual de Supabase.

Objetos que crea:

- tabla `plan_import_jobs`
- tabla `plan_import_logs`
- tabla `plan_import_samples`
- bucket privado `plan-imports`
- funcion `claim_next_plan_import_job(worker_mode text)`

## 2. Variables de entorno en Vercel

Configura estas variables en el proyecto web:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
ADMIN_ACCESS_PASSWORD=
OPENAI_API_KEY=
OPENAI_IMPORT_MODEL=gpt-4.1
```

## 3. Variables de entorno en el worker

El worker externo necesita:

```env
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SECRET_KEY=
OPENAI_API_KEY=
OPENAI_IMPORT_MODEL=gpt-4.1
PLAN_IMPORT_WORKER_POLL_MS=5000
```

`PLAN_IMPORT_WORKER_TOKEN` solo es necesario si quieres usar el endpoint interno:

- `/api/internal/plan-import-worker/run-next`

No hace falta para el worker continuo del repo, que consume la cola directamente desde Supabase.

## 4. Dependencias del worker

Node:

```bash
npm install
```

Python:

```bash
pip install -r scripts/requirements-plan-import-worker.txt
```

## 5. Verificacion local del worker

Comprobacion en seco:

```bash
npm run worker:plan-import:check
```

Procesar un solo job:

```bash
npm run worker:plan-import:once
```

Worker continuo:

```bash
npm run worker:plan-import
```

## 6. Despliegue con Docker

Construccion:

```bash
docker build -f Dockerfile.plan-import-worker -t sala-cenas-plan-import-worker .
```

Ejecucion:

```bash
docker run --env-file .env.local sala-cenas-plan-import-worker
```

Esto vale para `Render`, `Railway`, `Fly.io` o cualquier host similar.

## 7. Flujo esperado en produccion

1. El admin sube un plano desde Vercel.
2. La app guarda la imagen en Supabase Storage.
3. La app crea un job `pending`.
4. El worker reclama el job y lo procesa.
5. El worker guarda logs, resultado y estado final.
6. La UI consulta `status`.
7. Si el job termina en `review_pending`, se abre la revision.
8. Al confirmar o descartar, se actualiza el sample y el estado del job.

## 8. Checklist final

- migracion aplicada en Supabase
- bucket `plan-imports` creado
- variables de Vercel configuradas
- variables del worker configuradas
- worker desplegado y vivo
- `npm run worker:plan-import:check` pasando en el entorno del worker
- una importacion real creando job, logs y review final
