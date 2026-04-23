# Fase 7: despliegue y salida a produccion

Esta fase no consiste en cambiar la logica principal de la app, sino en dejarla
lista para salir del entorno local sin dejar cabos sueltos.

## Objetivo

Dejar preparado el proyecto para:

- desplegar en Vercel
- configurar bien las variables de entorno
- validar que Supabase sigue respondiendo en produccion
- evitar errores tipicos de un primer despliegue

## Como entender esta fase

Piensalo asi:

- local = el taller donde construimos y probamos
- produccion = el local abierto al publico

En local podemos permitirnos reiniciar, usar `seed.sql` y probar varias veces.
En produccion no.

## Lo que este proyecto necesita para desplegar

Para esta app no hace falta una configuracion rara de Vercel.
Next.js en Vercel funciona practicamente con configuracion cero.

Lo importante aqui es:

- subir el repo a GitHub
- importar el proyecto en Vercel
- poner las variables de entorno correctas
- comprobar que Supabase tiene todo lo que ya montamos en fases anteriores

## Variables de entorno que necesita Vercel

Estas dos:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

Son las mismas que ya usamos en local.

### Que significa cada una

- `NEXT_PUBLIC_SUPABASE_URL`: la direccion del proyecto de Supabase
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: la clave publica que puede usarse desde el frontend

## Que NO hay que poner en el frontend

No metas en Vercel ninguna clave privada de Supabase en el navegador:

- no `service_role`
- no `secret key`

Si algun dia hiciera falta una clave privada, iria solo en codigo de servidor y
con mucho cuidado.

## Checklist de produccion

Antes de desplegar, revisa esto:

### 1. Codigo

- `npm run lint` pasa
- `npm run build` pasa
- la Fase 6 funciona bien en local
- la primera parte de la Fase 7 de UX tambien funciona

### 2. Supabase

- existen las tablas del proyecto
- RLS esta activado
- los `GRANT` necesarios estan aplicados
- `reservas` esta metida en la publicacion de Realtime

### 3. Datos

- no ejecutar `supabase/seed.sql` en produccion
- usar `seed.sql` solo para desarrollo o reseteos de pruebas

### 4. Vercel

- proyecto importado desde GitHub
- framework detectado como Next.js
- variables de entorno cargadas
- despliegue completado sin errores

### 5. Comprobacion final

- cargar la portada
- buscar un asistente valido
- ver la sala
- reservar una silla libre
- comprobar que el cambio se refleja en pantalla

## Orden recomendado para desplegar

1. Subir el repositorio a GitHub.
2. Importarlo en Vercel.
3. Anadir las dos variables de entorno.
4. Lanzar el primer despliegue.
5. Probar el flujo completo.

## Dos formas de trabajar con Supabase en produccion

### Opcion simple

Usar el mismo proyecto de Supabase para local y produccion.

Ventaja:

- es mas rapido
- menos configuracion ahora

Riesgo:

- si haces pruebas reales sobre la misma base, puedes mezclar datos de trabajo con datos de test

### Opcion mas profesional

Tener un Supabase para pruebas y otro para produccion.

Ventaja:

- separas completamente pruebas y datos reales

Inconveniente:

- da mas trabajo ahora

## Mi recomendacion

Para un primer cierre funcional:

- desplegar primero con Vercel
- mantener el proyecto actual bien controlado
- y decidir despues si montamos un segundo Supabase para entorno de pruebas

Asi no bloqueamos el final del proyecto por una infraestructura mayor de la necesaria.

## Lo siguiente despues de este documento

Cuando quieras hacer el despliegue real:

1. conectamos el repo a GitHub si no esta ya
2. entramos en Vercel
3. configuramos variables
4. lanzamos el primer deploy
5. validamos la app ya publicada
