# Plan de implementacion: reserva presencial tactil

1. Reorganizar `src/app/page.tsx` para separar portada, modo presencial y modo movil.
2. Implementar pantalla de espera QR con captura automatica del lector y acceso manual por codigo.
3. Implementar modal de confirmacion de identidad tras lectura QR o codigo manual.
4. Extraer el flujo de reserva guiada en modales: resumen de mesa/silla y cuestionario.
5. Ampliar `DinnerRoomScene` para soportar modo presencial, fullscreen guiado y CTA flotante.
6. Mejorar interaccion tactil en `DinnerRoomPlan2D`.
7. Mejorar interaccion tactil en `DinnerRoomTable3D` y los controles 3D.
8. Conectar retorno automatico a espera QR tras confirmar una reserva presencial.
9. Verificar flujo movil, presencial, lint y build.
