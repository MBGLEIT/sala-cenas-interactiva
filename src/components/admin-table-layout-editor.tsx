"use client";

import { PointerEvent, useEffect, useRef, useState } from "react";

import { Mesa } from "@/lib/dinner-room";
import {
  ROOM_LAYOUT_HEIGHT,
  ROOM_LAYOUT_WIDTH,
  getEventBounds,
  getTableDimensions,
  getRectangleChairSlots,
} from "@/lib/room-layout";

type AdminTableLayoutEditorProps = {
  mesas: Mesa[];
  selectedMesaId: string;
  onSelectMesa: (mesaId: string) => void;
  onMoveMesa: (mesaId: string, posX: number, posY: number) => Promise<void>;
  disabled?: boolean;
};

type Position = {
  pos_x: number;
  pos_y: number;
};

type PanOffset = {
  x: number;
  y: number;
};

const MIN_ZOOM = 0.48;
const MAX_ZOOM = 1.9;
const ZOOM_STEP = 0.0012;
const CHAIR_WIDTH = 18;
const CHAIR_HEIGHT = 14;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

function createTransform(centerX: number, centerY: number, zoom: number, pan: PanOffset) {
  return `translate(${centerX + pan.x} ${centerY + pan.y}) scale(${zoom}) translate(${-centerX} ${-centerY})`;
}

export default function AdminTableLayoutEditor({
  mesas,
  selectedMesaId,
  onSelectMesa,
  onMoveMesa,
  disabled = false,
}: AdminTableLayoutEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  }>({
    active: false,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
  });
  const tableDragRef = useRef<{
    mesaId: string | null;
    pointerOffsetX: number;
    pointerOffsetY: number;
    moved: boolean;
  }>({
    mesaId: null,
    pointerOffsetX: 0,
    pointerOffsetY: 0,
    moved: false,
  });

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [draggingView, setDraggingView] = useState(false);
  const [draggingMesa, setDraggingMesa] = useState(false);
  const [zoom, setZoom] = useState(0.8);
  const [pan, setPan] = useState<PanOffset>({ x: 0, y: 0 });
  const [positions, setPositions] = useState<Record<string, Position>>({});

  const bounds = getEventBounds(mesas);
  const centerX = ROOM_LAYOUT_WIDTH / 2;
  const centerY = ROOM_LAYOUT_HEIGHT / 2;

  useEffect(() => {
    const nextPositions = Object.fromEntries(
      mesas.map((mesa) => [
        mesa.id,
        {
          pos_x: mesa.pos_x,
          pos_y: mesa.pos_y,
        },
      ]),
    );

    setPositions(nextPositions);
  }, [mesas]);

  useEffect(() => {
    const fitZoom = clamp(
      Math.min(
        (ROOM_LAYOUT_WIDTH * 0.72) / Math.max(bounds.width + 220, 520),
        (ROOM_LAYOUT_HEIGHT * 0.72) / Math.max(bounds.height + 220, 360),
      ),
      0.68,
      1.2,
    );

    setZoom(fitZoom);
    setPan({
      x: fitZoom * (centerX - bounds.centerX),
      y: fitZoom * (centerY - bounds.centerY),
    });
  }, [bounds.centerX, bounds.centerY, bounds.height, bounds.width, centerX, centerY]);

  useEffect(() => {
    function handleFullscreenChange() {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    }

    document.addEventListener("fullscreenchange", handleFullscreenChange);

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

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
      const pointerX = ((event.clientX - rect.left) / rect.width) * ROOM_LAYOUT_WIDTH;
      const pointerY = ((event.clientY - rect.top) / rect.height) * ROOM_LAYOUT_HEIGHT;

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

          return {
            x: pointerX - centerX - nextZoom * (worldX - centerX),
            y: pointerY - centerY - nextZoom * (worldY - centerY),
          };
        });

        return nextZoom;
      });
    }

    viewportElement.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      viewportElement.removeEventListener("wheel", handleWheel);
    };
  }, [centerX, centerY]);

  function getPointFromEvent(event: { clientX: number; clientY: number }) {
    const rect = viewportRef.current?.getBoundingClientRect();

    if (!rect) {
      return null;
    }

    const localX = ((event.clientX - rect.left) / rect.width) * ROOM_LAYOUT_WIDTH;
    const localY = ((event.clientY - rect.top) / rect.height) * ROOM_LAYOUT_HEIGHT;

    return {
      x: centerX + (localX - centerX - pan.x) / zoom,
      y: centerY + (localY - centerY - pan.y) / zoom,
    };
  }

  function handleViewportPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (disabled || event.button !== 0 || tableDragRef.current.mesaId) {
      return;
    }

    event.preventDefault();
    dragStateRef.current = {
      active: true,
      startX: event.clientX,
      startY: event.clientY,
      originX: pan.x,
      originY: pan.y,
    };
    setDraggingView(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleViewportPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (tableDragRef.current.mesaId) {
      const point = getPointFromEvent(event);
      if (!point) {
        return;
      }

      const mesaId = tableDragRef.current.mesaId!;
      const mesaDimensions = getTableDimensions(
        mesas.find((mesa) => mesa.id === mesaId)?.sillas.length ?? 8,
      );
      tableDragRef.current.moved = true;
      setPositions((current) => ({
        ...current,
        [mesaId]: {
          pos_x: Math.round(
            clamp(
              point.x - tableDragRef.current.pointerOffsetX,
              mesaDimensions.width / 2 + 50,
              ROOM_LAYOUT_WIDTH - mesaDimensions.width / 2 - 50,
            ),
          ),
          pos_y: Math.round(
            clamp(
              point.y - tableDragRef.current.pointerOffsetY,
              mesaDimensions.height / 2 + 50,
              ROOM_LAYOUT_HEIGHT - mesaDimensions.height / 2 - 50,
            ),
          ),
        },
      }));
      return;
    }

    if (!dragStateRef.current.active) {
      return;
    }

    const deltaX = ((event.clientX - dragStateRef.current.startX) /
      (viewportRef.current?.clientWidth ?? ROOM_LAYOUT_WIDTH)) *
      ROOM_LAYOUT_WIDTH;
    const deltaY = ((event.clientY - dragStateRef.current.startY) /
      (viewportRef.current?.clientHeight ?? ROOM_LAYOUT_HEIGHT)) *
      ROOM_LAYOUT_HEIGHT;

    setPan({
      x: dragStateRef.current.originX + deltaX,
      y: dragStateRef.current.originY + deltaY,
    });
  }

  async function endMesaDrag() {
    const mesaId = tableDragRef.current.mesaId;
    if (!mesaId) {
      return;
    }

    const position = positions[mesaId];
    tableDragRef.current.mesaId = null;
    setDraggingMesa(false);

    if (!position) {
      return;
    }

    await onMoveMesa(mesaId, position.pos_x, position.pos_y);
  }

  async function endViewportDrag(event: PointerEvent<HTMLDivElement>) {
    if (tableDragRef.current.mesaId) {
      await endMesaDrag();
    }

    if (dragStateRef.current.active) {
      dragStateRef.current.active = false;
      setDraggingView(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    }
  }

  function handleMesaPointerDown(event: PointerEvent<SVGElement>, mesaId: string) {
    if (disabled) {
      return;
    }

    const point = getPointFromEvent(event);
    const currentPosition = positions[mesaId];

    if (!point || !currentPosition) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    tableDragRef.current = {
      mesaId,
      pointerOffsetX: point.x - currentPosition.pos_x,
      pointerOffsetY: point.y - currentPosition.pos_y,
      moved: false,
    };
    setDraggingMesa(true);
    onSelectMesa(mesaId);
  }

  async function toggleFullscreen() {
    if (!containerRef.current) {
      return;
    }

    if (document.fullscreenElement === containerRef.current) {
      await document.exitFullscreen();
      return;
    }

    await containerRef.current.requestFullscreen();
  }

  return (
    <div
      ref={containerRef}
      className="overflow-hidden rounded-[28px] border border-stone-200 bg-[linear-gradient(180deg,_#ffffff,_#fafaf9)] p-4"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">
            Editor visual
          </p>
          <p className="mt-1 text-sm leading-6 text-stone-600">
            Arrastra la sala para moverte. Arrastra una mesa para recolocarla.
          </p>
        </div>

        <button
          type="button"
          onClick={toggleFullscreen}
          className="rounded-full border border-stone-300 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-stone-700 shadow-sm transition hover:border-stone-950 hover:text-stone-950"
        >
          {isFullscreen ? "Salir de pantalla completa" : "Pantalla completa"}
        </button>
      </div>

      <div
        ref={viewportRef}
        className={`overflow-hidden rounded-[22px] border border-stone-200 bg-stone-50 select-none ${draggingMesa || draggingView ? "cursor-grabbing" : "cursor-grab"}`}
        onPointerDown={handleViewportPointerDown}
        onPointerMove={handleViewportPointerMove}
        onPointerUp={endViewportDrag}
        onPointerLeave={endViewportDrag}
        style={{ touchAction: "none", overscrollBehavior: "contain" }}
      >
        <svg
          viewBox={`0 0 ${ROOM_LAYOUT_WIDTH} ${ROOM_LAYOUT_HEIGHT}`}
          className="h-full w-full"
        >
          <g transform={createTransform(centerX, centerY, zoom, pan)}>
            <rect
              x="0"
              y="0"
              width={ROOM_LAYOUT_WIDTH}
              height={ROOM_LAYOUT_HEIGHT}
              fill="#ece4d5"
            />

            <rect
              x="120"
              y="120"
              width={ROOM_LAYOUT_WIDTH - 240}
              height={ROOM_LAYOUT_HEIGHT - 240}
              rx="48"
              fill="#f7f0e5"
              stroke="#e7dcc7"
              strokeWidth="8"
            />

            {mesas.map((mesa) => {
              const currentPosition = positions[mesa.id] ?? {
                pos_x: mesa.pos_x,
                pos_y: mesa.pos_y,
              };
              const isSelected = selectedMesaId === mesa.id;
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
                    const sillaX = currentPosition.pos_x + slot.x;
                    const sillaY = currentPosition.pos_y + slot.y;

                    return (
                      <rect
                        key={silla.id}
                        x={sillaX - CHAIR_WIDTH / 2}
                        y={sillaY - CHAIR_HEIGHT / 2}
                        width={CHAIR_WIDTH}
                        height={CHAIR_HEIGHT}
                        rx="6"
                        fill="#d6d3d1"
                        stroke="#ffffff"
                        strokeWidth="2"
                      />
                    );
                  })}

                  <rect
                    x={currentPosition.pos_x - dimensions.width / 2 - 16}
                    y={currentPosition.pos_y - dimensions.height / 2 - 16}
                    width={dimensions.width + 32}
                    height={dimensions.height + 32}
                    rx="28"
                    fill="transparent"
                    onPointerDown={(event) => handleMesaPointerDown(event, mesa.id)}
                  />

                  <rect
                    x={currentPosition.pos_x - dimensions.width / 2}
                    y={currentPosition.pos_y - dimensions.height / 2}
                    width={dimensions.width}
                    height={dimensions.height}
                    rx="24"
                    fill={isSelected ? "#92400e" : "#5b4636"}
                    stroke={isSelected ? "#f59e0b" : "#3f2a1f"}
                    strokeWidth={isSelected ? 5 : 3}
                    onPointerDown={(event) => handleMesaPointerDown(event, mesa.id)}
                  />

                  <text
                    x={currentPosition.pos_x}
                    y={currentPosition.pos_y + 6}
                    textAnchor="middle"
                    fontSize="20"
                    fontWeight="700"
                    fill="#fefce8"
                    pointerEvents="none"
                  >
                    {`Mesa ${mesa.numero}`}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
    </div>
  );
}
