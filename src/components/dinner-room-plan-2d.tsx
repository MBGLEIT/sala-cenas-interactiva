"use client";

import { PointerEvent, useEffect, useMemo, useRef, useState } from "react";

import { EventoSala, Silla, normalizeReservas } from "@/lib/dinner-room";
import {
  ROOM_LAYOUT_HEIGHT,
  ROOM_LAYOUT_WIDTH,
  PlanFrame,
  getEventTitleFootprint,
  getProtectedCenteredPlanFrame,
  getProtectedEventBounds,
  getTableDimensions,
  getRectangleChairSlots,
} from "@/lib/room-layout";

type DinnerRoomPlan2DProps = {
  evento: EventoSala;
  selectedSillaId: string | null;
  currentAsistenteId: string;
  selectionLocked: boolean;
  onSelectSilla: (sillaId: string | null) => void;
  showCompatibilityMessage?: boolean;
  touchMode?: boolean;
  hideHeader?: boolean;
};

type PanOffset = {
  x: number;
  y: number;
};

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;
const ZOOM_STEP = 0.0012;

function clampPan(
  pan: PanOffset,
  zoom: number,
  width: number,
  height: number,
): PanOffset {
  if (zoom <= 1) {
    return { x: 0, y: 0 };
  }

  const maxX = ((zoom - 1) * width) / 2;
  const maxY = ((zoom - 1) * height) / 2;

  return {
    x: clamp(pan.x, -maxX, maxX),
    y: clamp(pan.y, -maxY, maxY),
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

function getChairColor(
  silla: Silla,
  selectedSillaId: string | null,
  currentAsistenteId: string,
) {
  const reservas = normalizeReservas(silla.reservas);
  const reservaActual = reservas[0];

  if (selectedSillaId === silla.id) {
    return "#facc15";
  }

  if (reservaActual?.asistente_id === currentAsistenteId) {
    return "#0ea5e9";
  }

  if (reservaActual) {
    return "#ef4444";
  }

  return "#22c55e";
}

function createTransform(centerX: number, centerY: number, zoom: number, pan: PanOffset) {
  return `translate(${centerX + pan.x} ${centerY + pan.y}) scale(${zoom}) translate(${-centerX} ${-centerY})`;
}

export default function DinnerRoomPlan2D({
  evento,
  selectedSillaId,
  currentAsistenteId,
  selectionLocked,
  onSelectSilla,
  showCompatibilityMessage = false,
  touchMode = false,
  hideHeader = false,
}: DinnerRoomPlan2DProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  }>({
    active: false,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
    moved: false,
  });

  const mesas = useMemo(
    () => [...evento.mesas].sort((a, b) => a.numero - b.numero),
    [evento.mesas],
  );
  const structureSignature = useMemo(
    () =>
      mesas
        .map((mesa) => `${mesa.numero}:${mesa.sillas.length}:${mesa.pos_x}:${mesa.pos_y}`)
        .sort()
        .join("|"),
    [mesas],
  );
  const protectedBounds = useMemo(
    () => getProtectedEventBounds(mesas, evento.nombre),
    [evento.nombre, mesas],
  );
  const titleFootprint = useMemo(
    () => getEventTitleFootprint(evento.nombre, ROOM_LAYOUT_WIDTH, ROOM_LAYOUT_HEIGHT),
    [evento.nombre],
  );
  const protectedFrame = useMemo(
    () => getProtectedCenteredPlanFrame(mesas, evento.nombre),
    [evento.nombre, mesas],
  );
  const [sceneFrame, setSceneFrame] = useState<PlanFrame>(protectedFrame);
  const centerX = sceneFrame.centerX;
  const centerY = sceneFrame.centerY;
  const [zoom, setZoom] = useState(0.9);
  const [pan, setPan] = useState<PanOffset>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const hasInitializedRef = useRef(false);
  const previousEventIdRef = useRef(evento.id);
  const previousStructureSignatureRef = useRef(structureSignature);

  useEffect(() => {
    const eventChanged = previousEventIdRef.current !== evento.id;
    const structureChanged =
      previousStructureSignatureRef.current !== structureSignature;

    if (eventChanged || structureChanged) {
      setSceneFrame(protectedFrame);
      hasInitializedRef.current = false;
      previousEventIdRef.current = evento.id;
      previousStructureSignatureRef.current = structureSignature;
    }
  }, [evento.id, protectedFrame, structureSignature]);

  useEffect(() => {
    const fitZoom = clamp(
      Math.min(
        (sceneFrame.width * 0.84) / Math.max(protectedBounds.width + 180, 520),
        (sceneFrame.height * 0.84) / Math.max(protectedBounds.height + 180, 360),
      ),
      0.72,
      1.38,
    );

    if (hasInitializedRef.current && mesas.length > 0) {
      return;
    }

    setZoom(fitZoom);
    setPan(
      clampPan(
        {
          x: 0,
          y: 0,
        },
        fitZoom,
        sceneFrame.width,
        sceneFrame.height,
      ),
    );
    hasInitializedRef.current = true;
  }, [mesas.length, protectedBounds.height, protectedBounds.width, sceneFrame.height, sceneFrame.width]);

  useEffect(() => {
    const viewportElement = viewportRef.current;

    if (!viewportElement) {
      return;
    }

    function handleWheel(event: WheelEvent) {
      if (!viewportElement) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const rect = viewportElement.getBoundingClientRect();
      const pointerX = sceneFrame.minX + ((event.clientX - rect.left) / rect.width) * sceneFrame.width;
      const pointerY = sceneFrame.minY + ((event.clientY - rect.top) / rect.height) * sceneFrame.height;

      setZoom((previousZoom) => {
        const nextZoom = clamp(
          previousZoom * (1 - event.deltaY * ZOOM_STEP),
          MIN_ZOOM,
          MAX_ZOOM,
        );

        if (nextZoom === previousZoom) {
          return previousZoom;
        }

        setPan((currentPan) => {
          const worldX = centerX + (pointerX - centerX - currentPan.x) / previousZoom;
          const worldY = centerY + (pointerY - centerY - currentPan.y) / previousZoom;

          return clampPan(
            {
              x: pointerX - centerX - nextZoom * (worldX - centerX),
              y: pointerY - centerY - nextZoom * (worldY - centerY),
            },
            nextZoom,
            sceneFrame.width,
            sceneFrame.height,
          );
        });

        return nextZoom;
      });
    }

    viewportElement.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      viewportElement.removeEventListener("wheel", handleWheel);
    };
  }, [centerX, centerY, sceneFrame.height, sceneFrame.minX, sceneFrame.minY, sceneFrame.width]);

  function handleChairSelection(
    sillaId: string,
    sillaOcupada: boolean,
    sillaEsDelAsistente: boolean,
  ) {
    if (selectionLocked || sillaOcupada || sillaEsDelAsistente) {
      return;
    }

    onSelectSilla(selectedSillaId === sillaId ? null : sillaId);
  }

  function handleViewportPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    dragStateRef.current = {
      active: true,
      startX: event.clientX,
      startY: event.clientY,
      originX: pan.x,
      originY: pan.y,
      moved: false,
    };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleViewportPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!dragStateRef.current.active) {
      return;
    }

    const deltaX = ((event.clientX - dragStateRef.current.startX) /
      (viewportRef.current?.clientWidth ?? sceneFrame.width)) *
      sceneFrame.width;
    const deltaY = ((event.clientY - dragStateRef.current.startY) /
      (viewportRef.current?.clientHeight ?? sceneFrame.height)) *
      sceneFrame.height;

    if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
      dragStateRef.current.moved = true;
    }

    setPan(
      clampPan(
        {
          x: dragStateRef.current.originX + deltaX,
          y: dragStateRef.current.originY + deltaY,
        },
        zoom,
        sceneFrame.width,
        sceneFrame.height,
      ),
    );
  }

  function endViewportDrag(event: PointerEvent<HTMLDivElement>) {
    if (!dragStateRef.current.active) {
      return;
    }

    dragStateRef.current.active = false;
    setDragging(false);

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    window.setTimeout(() => {
      dragStateRef.current.moved = false;
    }, 0);
  }

  function handleChairPointerDown(event: PointerEvent<SVGRectElement>) {
    event.preventDefault();
    event.stopPropagation();
  }

  function handleChairPointerUp(
    event: PointerEvent<SVGRectElement>,
    sillaId: string,
    sillaOcupada: boolean,
    sillaEsDelAsistente: boolean,
  ) {
    event.preventDefault();
    event.stopPropagation();

    if (dragStateRef.current.moved || dragStateRef.current.active) {
      return;
    }

    handleChairSelection(sillaId, sillaOcupada, sillaEsDelAsistente);
  }

  function adjustZoom(direction: "in" | "out") {
    setZoom((previousZoom) => {
      const nextZoom = clamp(
        previousZoom + (direction === "in" ? 0.16 : -0.16),
        MIN_ZOOM,
        MAX_ZOOM,
      );

      if (nextZoom === previousZoom) {
        return previousZoom;
      }

      setPan((currentPan) =>
        clampPan(currentPan, nextZoom, sceneFrame.width, sceneFrame.height),
      );

      return nextZoom;
    });
  }

  function resetView() {
    const fitZoom = clamp(
      Math.min(
        (sceneFrame.width * 0.84) / Math.max(protectedBounds.width + 180, 520),
        (sceneFrame.height * 0.84) / Math.max(protectedBounds.height + 180, 360),
      ),
      0.72,
      1.38,
    );

    setZoom(fitZoom);
    setPan(
      clampPan(
        {
          x: 0,
          y: 0,
        },
        fitZoom,
        sceneFrame.width,
        sceneFrame.height,
      ),
    );
  }

  return (
    <div className="relative flex h-full flex-col bg-[linear-gradient(180deg,_#ffffff,_#fafaf9)]">
      {!hideHeader ? (
        <div className="border-b border-stone-200 px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-700">
            Vista desde techo
          </p>
          <p className="mt-1 text-sm text-stone-600">
            {touchMode
              ? "Arrastra para mover el plano. Usa los botones para acercar, alejar o centrar."
              : "Rueda del raton para zoom. Arrastra para desplazarte por la sala."}
          </p>
          {showCompatibilityMessage ? (
            <p className="mt-1 text-xs leading-5 text-stone-500">
              Este equipo usa la vista 2D porque aqui el 3D no esta disponible.
            </p>
          ) : null}
        </div>
      ) : null}

      <div
        ref={viewportRef}
        className={`flex-1 overflow-hidden ${hideHeader ? "p-0" : "p-4"} select-none ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
        onPointerDown={handleViewportPointerDown}
        onPointerMove={handleViewportPointerMove}
        onPointerUp={endViewportDrag}
        onPointerLeave={endViewportDrag}
        style={{ touchAction: "none", overscrollBehavior: "contain" }}
      >
        <svg
          viewBox={`${sceneFrame.minX} ${sceneFrame.minY} ${sceneFrame.width} ${sceneFrame.height}`}
          className="h-full w-full rounded-[24px] border border-stone-200 bg-[#e9e1d1]"
        >
          <defs>
            <pattern
              id="hall-floor-pattern"
              patternUnits="userSpaceOnUse"
              width="160"
              height="160"
            >
              <rect width="160" height="160" fill="#d9ccb7" />
              <path d="M0 40 H160" stroke="#c7b49a" strokeWidth="2" />
              <path d="M0 80 H160" stroke="#cebca3" strokeWidth="2" />
              <path d="M0 120 H160" stroke="#c3b092" strokeWidth="2" />
              <path d="M40 0 V160" stroke="#c5b196" strokeWidth="2" />
              <path d="M80 0 V160" stroke="#cfbea8" strokeWidth="2" />
              <path d="M120 0 V160" stroke="#c5b196" strokeWidth="2" />
            </pattern>
            <pattern
              id="table-wood-pattern"
              patternUnits="userSpaceOnUse"
              width="36"
              height="36"
            >
              <rect width="36" height="36" fill="#6b4f3a" />
              <path d="M0 10 H36" stroke="#8a664a" strokeWidth="3" />
              <path d="M0 22 H36" stroke="#5b4432" strokeWidth="2.5" />
              <path d="M0 30 H36" stroke="#765741" strokeWidth="2" />
            </pattern>
          </defs>

          <g transform={createTransform(centerX, centerY, zoom, pan)}>
            <rect
              x={sceneFrame.minX + 36}
              y={sceneFrame.minY + 36}
              width={sceneFrame.width - 72}
              height={sceneFrame.height - 72}
              rx="36"
              fill="url(#hall-floor-pattern)"
              stroke="#dcccb1"
              strokeWidth="6"
            />

            <rect
              x={ROOM_LAYOUT_WIDTH / 2 - titleFootprint.safeWidth / 2}
              y={ROOM_LAYOUT_HEIGHT / 2 - titleFootprint.safeHeight / 2}
              width={titleFootprint.safeWidth}
              height={titleFootprint.safeHeight}
              rx="28"
              fill="#8b6b52"
              opacity="0.12"
              pointerEvents="none"
            />

            {mesas.map((mesa) => {
              const dimensions = getTableDimensions(mesa.sillas.length);
              const chairSlots = getRectangleChairSlots(
                mesa.sillas.length,
                dimensions.width,
                dimensions.height,
                dimensions.chairOffset,
              );

              return (
                <g key={mesa.id}>
                  {mesa.sillas.map((silla, index) => {
                    const slot = chairSlots[index];
                    const sillaX = mesa.pos_x + slot.x;
                    const sillaY = mesa.pos_y + slot.y;
                    const reservas = normalizeReservas(silla.reservas);
                    const sillaOcupada = reservas.length > 0;
                    const sillaEsDelAsistente =
                      reservas[0]?.asistente_id === currentAsistenteId;
                    const sillaColor = getChairColor(
                      silla,
                      selectedSillaId,
                      currentAsistenteId,
                    );

                    return (
                      <g key={silla.id}>
                        <rect
                          x={sillaX - (touchMode ? 34 : 26)}
                          y={sillaY - (touchMode ? 28 : 20)}
                          width={touchMode ? 68 : 52}
                          height={touchMode ? 56 : 40}
                          rx={touchMode ? 18 : 14}
                          fill="transparent"
                          onPointerDown={handleChairPointerDown}
                          onPointerUp={(event) =>
                            handleChairPointerUp(
                              event,
                              silla.id,
                              sillaOcupada,
                              sillaEsDelAsistente,
                            )
                          }
                        />
                        <rect
                          x={sillaX - 22}
                          y={sillaY - 16}
                          width="44"
                          height="32"
                          rx="10"
                          fill={sillaColor}
                          stroke="#ffffff"
                          strokeWidth="3"
                          pointerEvents="none"
                        />
                        <text
                          x={sillaX}
                          y={sillaY + 4}
                          textAnchor="middle"
                          fontSize="13"
                          fontWeight="700"
                          fill="#111827"
                          pointerEvents="none"
                        >
                          {silla.numero}
                        </text>
                      </g>
                    );
                  })}

                  <rect
                    x={mesa.pos_x - dimensions.width / 2}
                    y={mesa.pos_y - dimensions.height / 2}
                    width={dimensions.width}
                    height={dimensions.height}
                    rx="24"
                    fill="url(#table-wood-pattern)"
                    stroke="#3f2a1f"
                    strokeWidth="5"
                  />
                  <rect
                    x={mesa.pos_x - dimensions.width / 2 + 10}
                    y={mesa.pos_y - dimensions.height / 2 + 10}
                    width={dimensions.width - 20}
                    height={dimensions.height - 20}
                    rx="18"
                    fill="#f4ecdc"
                    opacity="0.85"
                    pointerEvents="none"
                  />
                  <text
                    x={mesa.pos_x}
                    y={mesa.pos_y + 8}
                    textAnchor="middle"
                    fontSize="20"
                    fontWeight="700"
                    fill="#2f241d"
                    pointerEvents="none"
                  >
                    {`Mesa ${mesa.numero}`}
                  </text>
                </g>
              );
            })}

            <text
              x={ROOM_LAYOUT_WIDTH / 2}
              y={ROOM_LAYOUT_HEIGHT / 2 + titleFootprint.planFontSize * 0.28}
              textAnchor="middle"
              fontSize={titleFootprint.planFontSize}
              fontWeight="700"
              fill="#6b6257"
              opacity="0.72"
              pointerEvents="none"
            >
              {titleFootprint.text}
            </text>
          </g>
        </svg>
      </div>

      {touchMode ? (
        <div
          className={`pointer-events-none absolute bottom-4 flex flex-col gap-3 ${
            hideHeader ? "left-4 right-auto" : "right-4 left-auto"
          }`}
        >
          <button
            type="button"
            onClick={() => adjustZoom("in")}
            className="pointer-events-auto inline-flex h-14 w-14 items-center justify-center rounded-full border border-stone-300 bg-white/95 text-2xl font-semibold text-stone-800 shadow-sm backdrop-blur transition hover:border-stone-950"
            aria-label="Acercar"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => adjustZoom("out")}
            className="pointer-events-auto inline-flex h-14 w-14 items-center justify-center rounded-full border border-stone-300 bg-white/95 text-2xl font-semibold text-stone-800 shadow-sm backdrop-blur transition hover:border-stone-950"
            aria-label="Alejar"
          >
            −
          </button>
          <button
            type="button"
            onClick={resetView}
            className="pointer-events-auto inline-flex min-h-12 items-center justify-center rounded-full border border-stone-300 bg-white/95 px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-stone-700 shadow-sm backdrop-blur transition hover:border-stone-950 hover:text-stone-950"
          >
            Centrar
          </button>
        </div>
      ) : null}
    </div>
  );
}
