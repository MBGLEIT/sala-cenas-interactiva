# Diseno de reserva presencial tactil y separacion de flujos

## Objetivo

Separar el acceso de reservas en dos modos:

- `Reserva Presencial`
- `Reserva Movil`

El modo presencial debe estar optimizado para equipos con pantalla tactil y lector QR conectado como dispositivo de entrada. El flujo presencial debe:

- identificar automaticamente al asistente al leer el QR
- mostrar una confirmacion previa con nombre y evento
- permitir corregir la identidad con codigo manual
- entrar en la sala en modo fullscreen y vista 2D por defecto
- permitir reservar tanto en 2D como en 3D
- guiar la reserva por pasos con modales claros
- volver automaticamente a la pantalla de espera QR al terminar

El modo movil mantiene el flujo actual, pero hereda mejoras tactiles y un flujo de confirmacion mas guiado.

## Flujo funcional

### Portada

La portada publica deja de mostrar directamente el formulario de codigo y pasa a mostrar dos botones principales:

- `Reserva Presencial`
- `Reserva Movil`

### Reserva presencial

1. Pantalla de espera QR.
   - El foco se mantiene preparado para recibir el codigo desde el lector.
   - Hay un boton `Volver al inicio` en la esquina inferior izquierda.
   - Si la lectura falla o el usuario necesita corregirla, debe existir acceso manual por codigo de asistente.

2. Confirmacion de identidad tras lectura.
   - Al recibir un codigo valido, se busca automaticamente al asistente y su evento.
   - Antes de entrar a la sala se abre un modal con:
     - nombre del asistente
     - nombre del evento
   - Acciones:
     - `Continuar` en verde, abajo a la derecha
     - `No eres tu?` abajo a la izquierda

3. Correccion manual.
   - Al pulsar `No eres tu?` se abre una identificacion manual por codigo de asistente.
   - Tras identificar manualmente, se vuelve al modal de confirmacion de identidad.

4. Entrada a la sala.
   - Al continuar, se entra automaticamente a la sala del evento asociado.
   - La vista inicial es `2D`.
   - Se intenta entrar en `pantalla completa`.
   - Se mantiene el selector `2D / 3D`.
   - No se muestra boton de salir de fullscreen dentro de la experiencia presencial.

5. Seleccion y confirmacion de silla.
   - Al tocar una silla reservable en 2D o 3D, se selecciona.
   - Aparece un boton flotante abajo a la derecha: `Confirmar reserva`.
   - Al pulsarlo se abre un primer modal con:
     - mesa
     - silla
     - boton `Cancelar`
     - boton `Continuar`

6. Cuestionario.
   - Tras continuar, se abre el cuestionario existente:
     - celiaco
     - alergias
     - movilidad reducida
     - observaciones
   - Un boton final confirma la reserva.

7. Fin del flujo.
   - Tras confirmar correctamente, el sistema limpia el estado local del asistente.
   - Se vuelve automaticamente a la pantalla de espera QR.

### Reserva movil

- Sigue el flujo actual de identificacion por codigo.
- Hereda el flujo guiado de seleccion y confirmacion:
  - seleccion de silla
  - boton `Confirmar reserva`
  - modal de resumen
  - modal de cuestionario

## Requisitos tactiles

### Generales

- Nada del flujo debe depender de hover.
- Las acciones principales deben ser grandes y visualmente claras.
- Las zonas tactiles de sillas y controles deben ampliarse.
- Debe haber feedback visual fuerte al seleccionar.
- Los modales deben tener jerarquia clara y botones grandes.

### Vista 2D

- El plano sigue siendo la vista principal para reservar.
- Debe soportar pan y zoom tactiles.
- Las sillas deben tener hit areas mayores que su dibujo visual.

### Vista 3D

- Debe seguir siendo una vista reservable.
- Los controles deben simplificarse para tacto.
- La navegacion debe limitarse para evitar desorientacion.
- La seleccion de sillas debe ser mas indulgente y clara.

## Arquitectura de frontend

### Estado de flujo principal

La pagina publica debe gestionar un estado de experiencia que distinga:

- portada
- presencial: espera QR
- presencial: confirmacion identidad
- presencial: acceso manual
- sala presencial
- sala movil

### Estado de reserva guiada

La confirmacion de la reserva deja de estar embebida directamente bajo la sala y pasa a un flujo por pasos:

- silla seleccionada
- modal de resumen abierto/cerrado
- modal de cuestionario abierto/cerrado

### Componentes nuevos o ampliados

- pantalla de seleccion de modo
- pantalla de espera QR
- modal de confirmacion de identidad
- modal de resumen de reserva
- modal de cuestionario de reserva
- extensiones de `DinnerRoomScene` para modo presencial y tactil

## Integracion con backend

No se requiere SQL nuevo ni cambios de esquema por este flujo. Se reutiliza:

- busqueda de asistente por identificador
- carga del evento asociado
- creacion de reserva existente

## Riesgos

- El fullscreen depende de restricciones del navegador y debe intentarse tras gesto del usuario cuando sea necesario.
- El lector QR puede inyectar retorno de carro, prefijos o sufijos; la pantalla de espera debe tolerarlo.
- La experiencia 3D tactil puede requerir varias iteraciones finas de sensibilidad y limites de camara.

## Criterios de exito

- Se puede entrar por `Reserva Presencial` y completar una reserva sin teclado ni raton.
- Tras leer QR aparece confirmacion de identidad antes de entrar.
- Se puede corregir la identidad con codigo manual.
- Se puede reservar en 2D y 3D.
- Al confirmar, en presencial se vuelve automaticamente a la espera QR.
- El flujo movil sigue funcionando y mejora la experiencia tactil.
